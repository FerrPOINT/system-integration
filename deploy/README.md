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
5. Выберите схематически совместимый кандидат восстановления. Публичный старый
   образ до V12 не является вариантом отката после удаления http_status.

В проверенной установке отдельный images.yml закрепляет образы вместе с
compose.yml и compose.public.yml. Он относится к runtime inputs, а не к
исходникам приложения. Не удаляйте его при очистке build/QA.

## Миграции и переключение

V11 нормализует прежние открытые DELIVERY_DELAYED с очередью, сохраняя счётчики,
историю и завершённость захвата. V12 удаляет только command_receipts.http_status.
Ключи, fingerprints, тела квитанций и время создания сохраняются.
V13 выделяет остановки чтения ленты в отдельную область. ID, статусы,
первичная диагностика и решения оператора сохраняются.
До запуска кандидата оба старых Java-процесса останавливаются: прежний отправитель
не должен работать одновременно с новой политикой и миграциями.
Применённые Flyway-миграции не редактируются и не удаляются.

Укажите абсолютные пути к каталогу выбранной установки и её приватному
environment file в `SI_RUNTIME_DIR` и `SI_RUNTIME_ENV_FILE`. Сверьте реальные
Compose labels и подготовьте `images.yml` с точными тегами проверенных образов.
Следующие команды применяются на существующей установке с исправным PostgreSQL.

~~~sh
cd "$SI_RUNTIME_DIR" || exit 1
test -f "$SI_RUNTIME_ENV_FILE" || exit 1
docker compose --env-file "$SI_RUNTIME_ENV_FILE" -p system-integration -f compose.yml -f compose.public.yml -f images.yml --profile app config --quiet
docker compose --env-file "$SI_RUNTIME_ENV_FILE" -p system-integration -f compose.yml -f compose.public.yml -f images.yml --profile app stop backend emulator
docker compose --env-file "$SI_RUNTIME_ENV_FILE" -p system-integration -f compose.yml -f compose.public.yml -f images.yml --profile app up -d --no-build --no-deps --wait backend emulator frontend
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
При неудаче не возвращайте несовместимый со схемой старый backend:
остановите неисправный процесс и используйте подготовленный совместимый образ.
Удаление тома или откат схемы с потерей данных недопустимы.

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
