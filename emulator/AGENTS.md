# Emulator

Отдельное Spring Boot-приложение: приём, исполнение, события и воспроизводимые сбои.
Использует свою БД и миграции src/main/resources/db/migration.
Слои controller/service/repository, чистый domain и mapper следуют общим правилам
[архитектуры](../docs/architecture.md#границы-кода).

Из корня Gradle адресуйте :emulator:bootJar, :emulator:test и :emulator:integrationTest.
Внешний OpenAPI генерируется в emulator/build и не зависит от build backend.
PostgreSQL-тесты используют только выделенную si_emulator_test на 19632.
MapStructConfig и OperationApiMapper принадлежат этому приложению; generated и
annotation processors следуют правилам backend. Публикация событий, счётчик курсора и исполнение остаются атомарными.
Worker создаётся штатным @Bean в scheduler/EmulatorWorkerConfiguration.
Конфигурация проверяет worker.enabled даже при отключённом worker: отсутствие
означает true, допустимы только true/false без учёта регистра; иные значения
прерывают запуск. Не добавляйте молчаливое отключение по неверной строке.
