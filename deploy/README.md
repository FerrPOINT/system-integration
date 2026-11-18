# Публикация демонстрации

Домен demo.azhukov-dev.ru обслуживается HTTPS-шлюзом и обратным SSH-туннелем.
Обычный Compose и отдельный QA не требуют изменения общего шлюза.
Версия источников, квалифицированного кандидата и работающего demo фиксируется
в [текущей стадии](../docs/current-stage.md).

## До обновления

1. Используйте квалифицированные образы одного source commit. Сборка, PostgreSQL,
   UI, recovery и NF08 выполняются на отдельном QA по [инструкции](../tests/README.md).
2. Проверьте фактический Compose project, каталог установки, config files и environment_file,
   image ID/revision, состояние контейнеров и версию Flyway. Не определяйте
   установку только по имени соседнего source checkout.
3. Зафиксируйте компактные контрольные сведения о существующих данных и образах.
   Проверка не создаёт незаказанные dumps/резервные копии.
4. Подготовьте image override установки: backend, emulator и frontend должны
   ссылаться на точные проверенные теги или digest. Проверьте labels и хеши
   извлечённых JAR/ассетов. Нельзя подменять квалифицированный образ повторной сборкой.
5. Сохраните прежние теги до начала миграций и сверьте порядок восстановления
   после перехода в разделе ниже.

В проверенной установке отдельный images.yml закрепляет образы вместе с
compose.yml и compose.public.yml. Он относится к runtime inputs, а не к
исходникам приложения. Не удаляйте его при очистке build/QA.

## Миграции и переключение

Переход с V13/V2 на V15/V3 меняет контракт у всех трёх компонентов. V14
нумерует существующие задания в порядке создания и ID. V15 обновляет
сохранённые документы и квитанции. V3 переносит настройки отказов на ID
операции и обновляет документы эмулятора. Прежние Flyway-миграции сохраняются
как история схемы.

После остановки Java-процессов запустите из checkout нового кандидата:

~~~sh
node deploy/prepare-task-numbers.mjs demo
node deploy/prepare-task-numbers.mjs demo --stage
~~~

Для репетиции на отдельном QA вместо demo передайте load. Первая команда
проверяет, что старый конфликт номера не превратится в автоматически
принимаемый результат, и находит по одному ID для каждого ещё не связанного
сбоя. Вторая сохраняет проверенные пары в служебной таблице миграции
эмулятора. V3 удаляет её после переноса. При неоднозначности остановитесь
до изменения схемы, разберите обнаруженную операцию и повторите проверку.

Перед переключением сравните число заданий, операций, историй и сверок,
наборы ID, счётчики попыток, исполнений и курсоры обеих БД. Для старых
квитанций проверьте повтор команды с исходным названием, включая задания,
которые успели переименовать. После миграции проверьте уникальность номеров
и отсутствие повторного исполнения. Сохранённая сверка с исторической
диагностикой читается по прежней ссылке.

Укажите абсолютные пути к каталогу выбранной установки и её приватному
environment file в `SI_RUNTIME_DIR` и `SI_RUNTIME_ENV_FILE`. Сверьте реальные
Compose labels и подготовьте `images.yml` с точными тегами проверенных образов.
Следующие команды применяются на существующей установке с исправным PostgreSQL.

~~~sh
cd "$SI_RUNTIME_DIR" || exit 1
test -f "$SI_RUNTIME_ENV_FILE" || exit 1
docker compose --env-file "$SI_RUNTIME_ENV_FILE" -p system-integration -f compose.yml -f compose.public.yml -f images.yml --profile app config --quiet
docker compose --env-file "$SI_RUNTIME_ENV_FILE" -p system-integration -f compose.yml -f compose.public.yml -f images.yml --profile app stop frontend backend emulator
# Между этими командами выполните проверку и подготовку V15/V3 из checkout кандидата.
docker compose --env-file "$SI_RUNTIME_ENV_FILE" -p system-integration -f compose.yml -f compose.public.yml -f images.yml --profile app up -d --no-build --no-deps --wait emulator
docker compose --env-file "$SI_RUNTIME_ENV_FILE" -p system-integration -f compose.yml -f compose.public.yml -f images.yml --profile app up -d --no-build --no-deps --wait backend
docker compose --env-file "$SI_RUNTIME_ENV_FILE" -p system-integration -f compose.yml -f compose.public.yml -f images.yml --profile app up -d --no-build --no-deps --wait frontend
systemctl status system-integration-tunnel.service
~~~

Из checkout квалифицированного кандидата выполните публичный smoke с
SI_DEMO_PASSWORD именно публичной демонстрации в окружении.
Compose --env-file сам по себе не экспортирует переменные для Node.
Из checkout кандидата, сохранив абсолютный SI_RUNTIME_ENV_FILE:

~~~sh
set -a
. "$SI_RUNTIME_ENV_FILE"
set +a
node --test tests/e2e/public.test.mjs
~~~

Пароль не печатается.
Не запускайте здесь seed/reset, recovery, нагрузку или тесты с TRUNCATE.

После переключения проверьте Flyway, сохранённые записи/квитанции, readiness,
labels всех трёх образов, фактически выдаваемые ассеты и TC-16 через HTTPS.
Тестирование локального QA не подтверждает новую версию домена.
До запуска миграций допустимо вернуть прежние теги исходной установки.
После миграции любой из БД держите обе версии клиентов на одной стороне
границы: при отказе остановите Java-процессы, определите фактически
применённые версии и завершите переход на проверенном совместимом кандидате.
Возврат к V13/V2 потребовал бы синхронного восстановления обеих БД из
подготовленного источника восстановления. Он выполняется отдельной
операцией с согласованным источником данных. Тома сохраняются.

## Сеть и сессия

compose.public.yml включает Secure cookie и restart policy после перезапуска Docker.
Для локальных HTTP-проверок используется основной Compose.
UI, recovery и нагрузка принадлежат отдельному проекту system-integration-load;
его reset никогда не направляется на обычные si_app/si_emulator.

В deploy/ сохранены конфигурации Nginx, sshd и systemd. На HTTPS-шлюзе sshd
разрешает отдельной учётке только обратный порт 127.0.0.1:19573.
Ключ и проверенный SSH host key хранятся вне Git. Сервер приложения использует
/etc/systemd/system/system-integration-tunnel.service от пользователя ferrpoint.
На шлюзе установлены /etc/nginx/conf.d/system-integration.conf и
/etc/ssh/sshd_config.d/61-system-integration.conf.
Перед изменением соответствующей службы обязательны nginx -t и sshd -t.

Сертификат обслуживает существующий Certbot; deploy hook
/etc/letsencrypt/renewal-hooks/deploy/demo-certificate обновляет TLS-файлы Xray.
Обычное обновление приложения не требует изменения TLS-каталога или перезапуска
общего Xray. Публичный вход ограничен 10 попытками в минуту на IP с запасом
10 запросов; превышение даёт 429.

## Завершение

Обновите current-stage только по фактическим результатам новой установки.
Удалите собственные завершённые QA-ресурсы и транспортные архивы уже
опубликованных образов. Сохраните работающие runtime inputs, данные,
проверенные образы восстановления и компактный результат приёмки.
