# Emulator

Отдельное Spring Boot-приложение: приём, исполнение, события и воспроизводимые сбои.
Использует свою БД и миграции src/main/resources/db/migration.
Слои domain/application/infrastructure/web следуют общим правилам
[архитектуры](../docs/architecture.md#границы-кода).

Из корня Gradle адресуйте :emulator:bootJar, :emulator:test и :emulator:integrationTest.
Внешний OpenAPI генерируется в emulator/build и не зависит от build backend.
PostgreSQL-тесты используют только выделенную si_emulator_test на 19632.
Публикация событий, счётчик курсора и исполнение остаются атомарными.
