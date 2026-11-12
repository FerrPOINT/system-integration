# Обмен с внешней системой

Внутренний сервис принимает задания и показывает, принял ли их внешний
исполнитель и с каким результатом выполнил. Исполнителя представляет отдельный
эмулятор. Разработка идёт по [декомпозиции](docs/decomposition.md).
Проверенные возможности и оставшаяся приёмка указаны в [текущей стадии](docs/current-stage.md).

## Локальный запуск

Для полного стенда нужен Docker Compose v2; для демокоманды и тестов —
Node.js 24 с Corepack. При запуске Java вне контейнеров нужен JDK 25.
Gradle Wrapper закрепляет
Gradle 9.9.1, `frontend/package.json` — pnpm 12.19.0. Контейнерные сборки используют
Temurin 25.0.5 и Node.js 24.19.0. Backend собран на Spring Boot 4.1.2.

В корне скопируйте `.env.example`
в `.env` и задайте шесть разных локальных паролей. `SI_DEMO_PASSWORD`
должен содержать не меньше 12 символов. Файл `.env` исключён из Git.

Полный запуск в контейнерах описан в [сборке и проверках](#сборка-и-проверки).
Команды ниже запускают приложения отдельно для разработки.

```sh
docker compose up -d --wait postgres
docker compose ps
```

PostgreSQL 18.6 хранит данные в томе `system-integration_postgres`.
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
cd backend
sh ./gradlew bootRun --args=--spring.profiles.active=demo-users
```

В PowerShell замените `sh ./gradlew` на `.\gradlew.bat`. Если терминал
использует другой JDK, укажите путь к JDK 25 в `JAVA_HOME`.

Эмулятор запускается отдельным процессом из `backend/`. Профиль
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

Соберите backend из каталога `backend/`.

```sh
sh ./gradlew --no-daemon --max-workers=2 :test :bootJar :emulator:bootJar
```

Транзакционные и API-тесты отдельно используют настоящий PostgreSQL `si_test`.
После запуска Compose и загрузки `.env`, из `backend/`:

```sh
sh ./gradlew --no-daemon --max-workers=2 :integrationTest :emulator:integrationTest
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

Снятие режима потери ответа выпускает удержанные события. Файл
`tests/results/demo.json` содержит ID созданных заданий и операций.
Браузерные сценарии и нагрузка запускаются по [инструкции тестов](tests/README.md)
и [профилю NF08](tests/load/README.md).

Соберите frontend и проверьте клиент из `frontend/` после установки зависимостей.

```sh
corepack pnpm build
corepack pnpm test:api
```

Проверка HTTP после сборки описана в [инструкции для тестов](tests/README.md).

## Генерация из OpenAPI

Gradle перед компиляцией генерирует Spring MVC интерфейсы и DTO обеих схем
в `backend/build/generated/openapi/`. Vite получает Fetch-клиент и DTO
внутренней схемы из `frontend/build/generated/openapi/`. Команды
`corepack pnpm dev` и `corepack pnpm build` запускают Orval автоматически.
Для одной генерации вызовите `sh ./gradlew openApiGenerate generateExchangeApi`
из `backend/` и `corepack pnpm generate:api` из `frontend/`.
Каталоги сборки игнорируются Git.

## Допущения

- Эмулятор проверяет количество в вымышленной заявке. Название задания
  редактируется отдельно от отправленного запроса.
- Создатель остаётся владельцем задания. Оператор может взять открытую
  проблему на себя, в том числе перенять её у другого оператора.
  История хранит обоих ответственных и автора передачи.
- Даты и периоды считаются в UTC. У задания нет дедлайна. Интерфейс показывает
  время создания и исполнения.
- После длительного сбоя доставка автоматически продолжается с прежним ID
  по единому расписанию очереди. После ошибки протокола оператор сверяет
  состояние и решает возобновить либо прекратить отправку с причиной.
  [Правила доставки](docs/analysis.md#доставка-и-повтор)

## Ограничения локального стенда

Некорректная структура или курсор внешней ленты останавливают её чтение.
После исправления источника перезапустите backend: он продолжит с сохранённой
позиции. Ошибки отдельных результатов оформляются как проблемы и не блокируют
другие операции. Служебные команды сбоев включены профилем `test-faults` и
предназначены для локальной проверки; порты Compose доступны только с этого
компьютера. Публичный домен и TLS конфигурация запуска не настраивает.

## Документация

| Что нужно | Где смотреть |
| --- | --- |
| Исходное задание и критерии | [ТЗ 2.1](docs/original-specification.md), [требования](docs/requirements.md). |
| Правила, экраны и модель данных | [Аналитика](docs/analysis.md), [архитектура](docs/architecture.md). |
| Контракты REST | [Приложение](contracts/internal-api.openapi.yaml), [эмулятор](contracts/external-exchange.openapi.yaml). |
| План и состояние работы | [Роадмап](docs/roadmap.md), [задачи](docs/decomposition.md), [текущая стадия](docs/current-stage.md). |
| Проверки и сдача | [Сценарии приёмки](docs/test-cases.md), [план эксплуатации и комплект сдачи](docs/roadmap.md#эксплуатация-и-сдача). |
| Вклад и безопасность | [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [AGENTS](AGENTS.md). |
