# Обмен с внешней системой

Внутренний сервис принимает задания и показывает, принял ли их внешний
исполнитель и с каким результатом выполнил. Исполнителя представляет отдельный
эмулятор. Разработка идёт по [декомпозиции](docs/decomposition.md).
Проверенные возможности и оставшаяся приёмка указаны в [текущей стадии](docs/current-stage.md).

## Рабочая среда

Рабочую среду задаёт поручение: локальный Windows checkout или явно выбранный
Firebat1 по SSH. Исходники и выбранный checkout проверяются по [AGENTS.md](AGENTS.md);
фактическая среда квалификации указана в [текущей стадии](docs/current-stage.md).
Публичная демонстрация — [demo.azhukov-dev.ru](https://demo.azhukov-dev.ru/).
Демонстрационный runtime и изолированный тестовый system-integration-load —
разные окружения: тесты и нагрузку не направляем на публичную БД.
Точная версия и результаты приёмки указаны в [текущей стадии](docs/current-stage.md).

### Локальный Windows preview

Команды ниже запускают локальный preview на Windows. Отдельные API, эмулятор и БД
используют проект system-integration-load и порты 19680/19681/19632;
Vite с HMR — [127.0.0.1:19673](http://127.0.0.1:19673/).
После настройки Node/Corepack по [AGENTS.md](AGENTS.md):

```powershell
docker compose -p system-integration-load -f compose.yml -f compose.load.yml --profile app up -d --no-build --wait postgres backend emulator
Push-Location frontend
try { corepack pnpm dev } finally { Pop-Location }
```

Эти команды используют уже собранные локальные образы; изменение backend
требует их локальной сборки через общий host execution slot. Для полного
Compose/UI-прогона Vite освобождает порт 19673 frontend-контейнеру.
Приведённые ниже порты 195xx относятся к обычному Compose и публикации.

## Диагностика обмена

GET /actuator/exchange доступен на приватном backend с операторской сессией:
anonymous получает 401, инициатор — 403. Frontend proxy его не публикует.
Ответ содержит observedAt, workerEnabled, feed paused/lastSuccessfulRead/
unavailableReads/invalidPages/deliveryInFlight и deliveryQueue operations/oldestCreatedAt.
Очередь читается один раз по запросу и включает parked deliveries; это не всё
business pending. Возраст oldestCreatedAt считается относительно observedAt.
deliveryInFlight считает активные HTTP-доставки, а не чтение ленты.
Feed counters локальны процессу; restart их обнуляет, а очередь остаётся в БД.
si.exchange.enabled поддерживает true/false без учёта регистра; неоднозначные
aliases yes/on/1 и ошибочные значения явно отклоняются при старте.
Readiness зависит от приложения/БД, не от доступности исполнителя.

API возвращает серверный X-Request-ID; caller ID игнорируется. Ошибки HTTP
и прикладной audit используют requestId в журнале; после запроса MDC очищается.
Эмулятор пишет lifecycle события после commit без тел запросов.
Безопасная protocol detail сохраняется в существующем Evidence.reason;
canonical reason/content для дедупликации и сохранённые receipts не меняются.

## Доступ к данным

Карточка, реестр и история заданий читаются через Spring Data JDBC.
Изменения, outbox, квитанции, блокировки и сложные проекции выполняются
явным SQL через JdbcTemplate. Оба механизма используют один DataSource и
менеджер транзакций; Hibernate/JPA не подключены. API не отдаёт persistence
records или Spring Page. Причины и владельцы — в
[архитектуре](docs/architecture.md#чтение-кэш-и-повтор-команд),
план проверки — [SD-00–SD-06](docs/spring-data-read-plan.md).

## Интерфейс

В шапке и на экране входа доступны тёмная, светлая и серая темы.
Первый запуск использует тёмную независимо от настроек ОС. Выбор хранится
в этом браузере, сохраняется после выхода и синхронизируется между вкладками.
При запрете хранения выбор действует до закрытия вкладки; интерфейс сообщает об этом.

На телефоне реестр переходит в карточки, фильтры сворачиваются.
Навигация выделяет текущий раздел; данные формы сохраняются при смене темы.
Фильтры применяются сразу без «Применить», сохраняются в URL и сбрасывают
страницу. Пагинация показывает номера, общее число страниц и записей.

Свежесть, инвалидация, изоляция кэша, повторы команд, настройки потоков и политика
версий описаны в [архитектуре](docs/architecture.md#чтение-кэш-и-повтор-команд).
Виртуальные HTTP-потоки включены, настройки PostgreSQL и Java проверены
на запущенном приложении. Результаты полного аудита исходного ТЗ,
автотестов, восстановления и нагрузки — в [текущей стадии](docs/current-stage.md).
Подтверждённый профиль —
[NF08](tests/load/README.md), его прохождение не гарантирует произвольную нагрузку.

Внешний HTTP настраивается через si.exchange.http: base-url (прежний
SI_EMULATOR_URL сохранён), connect-timeout=1s, response-timeout=2s,
max-response-size=256KB. Последний ограничивает фактические байты ответа,
включая chunked, а не количество принимаемых заданий. Параметры валидируются
при старте; ограничения и владельцы — в [архитектуре](docs/architecture.md#потоки-и-ограничение-параллелизма).

## Локальный запуск

Для полного стенда нужен Docker Compose v2; для демокоманды и тестов —
Node.js 26 с Corepack. При запуске Java вне контейнеров нужен JDK 25.
Gradle Wrapper закрепляет
Gradle 9.9.1, `frontend/package.json` — pnpm 12.19.0. Контейнерные сборки используют
Temurin 25.0.5 и Node.js 26.13.1. Backend собран на Spring Boot 4.1.2.
Явные controller/service/repository и mapper описаны в
[архитектуре](docs/architecture.md#границы-кода). MapStruct 1.6.3 и Lombok 1.18.48
настроены в root Gradle; код генерируется при сборке в build и не хранится в Git.

В корне скопируйте `.env.example`
в `.env` и задайте шесть разных локальных паролей. `SI_DEMO_PASSWORD`
должен содержать не меньше 12 символов. Файл `.env` исключён из Git.

Полный запуск в контейнерах описан в [сборке и проверках](#сборка-и-проверки).
Команды ниже запускают приложения отдельно для разработки.

```sh
docker compose up -d --wait postgres
docker compose ps
```

PostgreSQL 18.7 хранит данные в томе `system-integration_postgres`.
Базы `si_app`, `si_emulator`, `si_test` и `si_emulator_test` принадлежат разным ролям.
Роль приложения не подключается к БД эмулятора. Диагностический порт
`19532` доступен только на `127.0.0.1`. Сеть проекта — `10.252.95.0/24`;
при конфликте с вашей сетью измените её в `compose.yml` до первого запуска.

Перед запуском Java загрузите `.env` в окружение каждого терминала.
В PowerShell из корня репозитория:

```powershell
$settings = docker compose --profile app config --format json | ConvertFrom-Json
foreach ($name in 'SI_DB_PASSWORD', 'SI_EMULATOR_DB_PASSWORD',
    'SI_TEST_DB_PASSWORD', 'SI_EMULATOR_TEST_DB_PASSWORD') {
    [Environment]::SetEnvironmentVariable($name,
        [string]$settings.services.postgres.environment.$name, 'Process')
}
$env:SI_DEMO_PASSWORD = [string]$settings.services.backend.environment.SI_DEMO_PASSWORD
```

В POSIX shell выполните `set -a`, затем `. ./.env` и `set +a`.
Запустите backend. Профиль `demo-users` создаёт отсутствующих
`initiator.one`, `initiator.two` и `operator`, сохраняя хеш пароля.
Существующие пароли и роли он не меняет. После первичной загрузки
запускайте без этого профиля.

```sh
sh ./gradlew :backend:bootRun --args=--spring.profiles.active=demo-users
```

В PowerShell замените `sh ./gradlew` на `.\gradlew.bat`. Если терминал
использует другой JDK, укажите путь к JDK 25 в `JAVA_HOME`.

Эмулятор запускается отдельным процессом из корня репозитория. Профиль
`test-faults` включает служебные команды воспроизведения сбоев.

```sh
sh ./gradlew :emulator:bootRun --args=--spring.profiles.active=test-faults
```

Для frontend откройте ещё один терминал в корне репозитория.

```sh
cd frontend
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

| Что открыть | Ожидаемый результат |
| --- | --- |
| [Frontend](http://127.0.0.1:19573/) | Вход, реестр и карточка. |
| [Готовность API](http://127.0.0.1:19580/actuator/health/readiness) | `UP` после миграций и подключения PostgreSQL. |
| [Готовность эмулятора](http://127.0.0.1:19581/actuator/health/readiness) | Независимая проверка процесса и его БД. |

Vite направляет `/api` на порт `19580`; браузер работает в одном origin.
Backend обращается к эмулятору по `SI_EMULATOR_URL`
(по умолчанию `http://127.0.0.1:19581`). Адреса БД переопределяются
`SI_DB_URL` и `SI_EMULATOR_DB_URL`.

Для остановки приложений нажмите `Ctrl+C`, для БД выполните
`docker compose stop`. `docker compose down` сохраняет том.
Не добавляйте `--volumes`, если нужны сохранённые данные.

## Форматирование кода

Общие переводы строк LF, UTF-8 и завершающая новая строка заданы в
.editorconfig. Java в backend/emulator форматирует
[Spotless](https://github.com/diffplug/spotless/tree/main/plugin-gradle):
google-java-format 2.0.0, AOSP, 4 пробела, ширина 120. Проверяется только
рукописный src/**/*.java; generated в build и применённые миграции исключены.
Автоматические semantic cleanups отключены. Imports сортируются, неиспользуемые
удаляются штатным formatter. Сочетания полей/бизнес-правила не меняются.

[Prettier](https://prettier.io/docs/install) 3.10.1 форматирует TS/TSX,
CSS, JS-тесты и frontend-конфигурации: 2 пробела, ширина 120, одинарные
кавычки в JS/TS, точки с запятой. .prettierignore исключает generated/build,
node_modules, результаты и lockfile. Версии закреплены в Gradle/package.json
и lockfile; не используйте npx с автоматически загружаемой latest.

Общий проход выполнен по поручению пользователя. Format-on-save включён
для настроенных редакторов. Gradle build/check выполняет spotlessCheck;
frontend build — format:check, ESLint и TypeScript. Docker targets проверяют
тот же стиль; frontend builder получает корневые настройки и исходники тестов,
которые не попадают в финальный образ. Проверки завершаются ошибкой при
расхождении, а не меняют файлы автоматически.

Команды исправления и проверки стиля, из корня проекта:

~~~sh
./gradlew spotlessApply
./gradlew spotlessCheck
cd frontend
corepack pnpm format
corepack pnpm format:check
~~~

В VS Code рекомендованы Prettier и Spotless Gradle; в IntelliJ используйте
Spotless plugin с этими Gradle-правилами,
для frontend — локальный frontend/node_modules/prettier.
CLI остаётся источником истины. Новых CI jobs и Git hooks нет.

## Сборка и проверки

Полный локальный стенд собирается из исходников. После заполнения `.env`,
из корня репозитория:

```sh
docker compose --profile app build backend
docker compose --profile app build emulator
docker compose --profile app build frontend
docker compose --profile app up -d --wait
```

Откройте `http://127.0.0.1:19573`. API, эмулятор и PostgreSQL публикуют
диагностические порты только на loopback. Состояния здоровья и миграции
проверяются при запуске. Для остановки — `docker compose --profile app stop`.
Сборка контейнеров не заменяет интеграционные и браузерные проверки.

Java-сборка запускается из корня репозитория; приложения адресуются отдельно.

```sh
sh ./gradlew --no-daemon --max-workers=2 :backend:test :emulator:test :backend:bootJar :emulator:bootJar
```

Транзакционные и API-тесты отдельно используют настоящий PostgreSQL `si_test`.
Используется отдельный PostgreSQL system-integration-load на 19632;
фоновые приложения этого проекта должны быть остановлены. Обычный стенд
продолжает работать. Из корня с загруженным окружением:

~~~sh
docker compose -p system-integration-load -f compose.yml -f compose.load.yml --profile app stop backend emulator
docker compose -p system-integration-load -f compose.yml -f compose.load.yml --profile app up -d --wait postgres
~~~

Затем из корня репозитория:

```sh
sh ./gradlew --no-daemon --max-workers=2 :backend:integrationTest :emulator:integrationTest
```

Команда требует `SI_TEST_DB_PASSWORD` и `SI_EMULATOR_TEST_DB_PASSWORD`,
очищает только выделенные тестовые БД и не запускает фоновые отправки. Отчёт приложения —
`backend/build/reports/tests/integrationTest/index.html`.

Для демонстрации запущенного стенда загрузите `.env` в окружение терминала
и из корня выполните:

```sh
node tests/demo.mjs seed
```

Создаются шесть заданий: успех, бизнес-отказ, недоступность исполнителя,
потеря ответа, дубликат и запоздалый снимок. Демоучётки — `initiator.one`,
`initiator.two` и `operator`, пароль берётся из `SI_DEMO_PASSWORD`.
Сценарии используют зарезервированные демонстрационные номера
`REQ-900001`–`REQ-900006` и постоянные ключи команд.

Команды управления и независимого чтения:

```sh
node tests/demo.mjs fault REQ-900003 UNAVAILABLE
node tests/demo.mjs clear REQ-900003
node tests/demo.mjs clear REQ-900004
node tests/demo.mjs inspect <operation-id>
```

После исчерпания пяти вызовов снятия недоступности недостаточно:
войдите оператором, откройте задание, выполните свежую сверку, перейдите
к разбору и выберите «Повторить обмен» с причиной. Новая серия сохранит ID.
Снятие режима потери ответа выпускает удержанные события. Файл
`tests/results/demo.json` содержит ID созданных заданий и операций.
Браузерные сценарии и нагрузка запускаются по [инструкции тестов](tests/README.md)
и [профилю NF08](tests/load/README.md).

Соберите frontend и проверьте клиент из `frontend/` после установки зависимостей.

```sh
corepack pnpm build
corepack pnpm test:assets
corepack pnpm test:api
```

Build включает generation, ESLint React/Query/import boundaries, строгий TypeScript
и Vite. `test:api` также запускает unit projections/positions, URL/polling и
отрицательные lint fixtures. Структура app → features/{auth,tasks,operations} →
shared и владельцы состояния описаны в [архитектуре](docs/architecture.md#архитектура-react).
Component runner и полный UI-прогон разделены в [инструкции тестов](tests/README.md).

Проверка HTTP после сборки описана в [инструкции для тестов](tests/README.md).

## Генерация из OpenAPI

Gradle перед компиляцией генерирует Spring MVC интерфейсы и DTO обеих схем
в `backend/build/generated/openapi/`. Эмулятор независимо генерирует внешнюю
схему в `emulator/build/generated/openapi/`. Vite получает Fetch-клиент и DTO
внутренней схемы из `frontend/build/generated/openapi/`. Команды
`corepack pnpm dev` и `corepack pnpm build` запускают Orval автоматически.
Для одной генерации из корня вызовите
`sh ./gradlew :backend:openApiGenerate :backend:generateExchangeApi :emulator:openApiGenerate`,
для frontend — `corepack pnpm generate:api` из `frontend/`.
Каталоги сборки игнорируются Git.

## Допущения

- Эмулятор проверяет количество в вымышленной заявке. Название задания
  редактируется отдельно от отправленного запроса.
- Создатель остаётся владельцем задания. Оператор может взять открытую
  проблему на себя, в том числе перенять её у другого оператора.
  История хранит обоих ответственных и автора передачи.
- Даты и периоды считаются в UTC, поддерживаются годы 0001–9999.
  Внешний wire-формат — RFC 3339 с обязательными секундами, до девяти знаков
  дробной части и UTC (Z либо +00:00); -00:00 как неизвестный offset не принимается.
  Фильтры нормализуются штатным ISO-парсером Spring и проверяют тот же диапазон.
  У задания нет дедлайна. Интерфейс показывает
  время создания и исполнения.
- На серию доставки отведено пять автоматических вызовов, включая PUT, GET
  и прерванные захваты. Задержки между ними — 2/5/15/60 с. После исчерпания
  доставка приостанавливается до решения оператора; ошибка протокола
  останавливает её раньше. Оператор выполняет свежую сверку и с причиной
  разрешает новую серию, принимает готовый результат либо прекращает отправку.
  ID операции и общий журнал попыток сохраняются. Повтор команды не начинает
  ещё одну серию. Одновременно работают не более четырёх отправителей;
  чтение ленты и ручная сверка выполняются отдельно.
  [Правила доставки](docs/analysis.md#доставка-и-повтор).

## Ограничения локального стенда

При интенсивном создании заданий внешняя очередь растёт. Отчёт NF08
отдельно учитывает завершённые операции, задания без итога и время
от создания до внешнего исполнения.

Некорректная структура или курсор внешней ленты останавливают её чтение.
После исправления источника перезапустите backend: он продолжит с сохранённой
позиции. Ошибки отдельных результатов оформляются как проблемы и не блокируют
другие операции. Служебные команды сбоев включены профилем `test-faults` и
предназначены для локальной проверки; порты Compose доступны только с этого
компьютера. Публичный домен и TLS конфигурация запуска не настраивает.

## Публичный стенд

Адрес — [demo.azhukov-dev.ru](https://demo.azhukov-dev.ru).
Публикация использует существующий TLS gateway Koara и отдельный SSH-туннель
на Firebat1. Доступны три демоучётки из раздела запуска; пароль хранится
в приватном `SI_DEMO_PASSWORD`. Установка не публикует порты БД и эмулятора.

На Firebat1 полный стенд запускается с HTTPS-настройками:

```sh
docker compose -f compose.yml -f compose.public.yml --profile app up -d --wait
systemctl status system-integration-tunnel.service
node --test tests/e2e/public.test.mjs
```

`compose.public.yml` включает Secure cookie и автоматическое восстановление
контейнеров после перезапуска Docker. Для локальных HTTP-проверок используйте
основной Compose. UI, восстановление и нагрузка запускаются отдельным
проектом system-integration-load через compose.load.yml; демонстрационный
стенд и его публичный туннель при этих проверках не отключаются.
Команды — в tests/load/README.md.

В `deploy/` сохранены конфигурации Nginx, sshd и systemd. На Koara sshd
разрешает отдельной учётке только обратный порт `127.0.0.1:19573`;
ключ и проверенный SSH host key хранятся вне Git. Firebat1 использует
`/etc/systemd/system/system-integration-tunnel.service` от пользователя
`ferrpoint`. На Koara конфигурации установлены в
`/etc/nginx/conf.d/system-integration.conf` и
`/etc/ssh/sshd_config.d/61-system-integration.conf`. После изменения
проверяйте `nginx -t` и `sshd -t` перед reload соответствующей службы.

Сертификат домена обслуживает существующий Certbot. Его deploy hook
`/etc/letsencrypt/renewal-hooks/deploy/demo-certificate` обновляет TLS-файлы,
которые читает общий Xray. Действующий каталог TLS сохраняется независимо
от удаления приложения Mini-CRM. Обновление приложения не требует
перезапуска общего Xray. Публичный вход ограничивает частоту попыток входа:
10 в минуту на адрес с кратковременным запасом 10 запросов, ответ 429.

## Документация

| Что нужно | Где смотреть |
| --- | --- |
| Исходное задание и критерии | [ТЗ 2.1](docs/original-specification.md), [требования](docs/requirements.md). |
| Правила, экраны и модель данных | [Аналитика](docs/analysis.md), [архитектура](docs/architecture.md), [поток задания](docs/architecture.md#типичный-поток-задания). |
| Контракты REST | [Приложение](contracts/internal-api.openapi.yaml), [эмулятор](contracts/external-exchange.openapi.yaml). |
| План и состояние работы | [Роадмап](docs/roadmap.md), [задачи](docs/decomposition.md), [текущая стадия](docs/current-stage.md). |
| Проверки и сдача | [Сценарии приёмки](docs/test-cases.md), [план эксплуатации и комплект сдачи](docs/roadmap.md#эксплуатация-и-сдача). |
| Вклад и безопасность | [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [AGENTS](AGENTS.md). |
