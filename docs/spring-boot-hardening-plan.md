# План доработок backend и emulator по Spring Boot

Дата: 14.11.2026. Статус: повторный аудит завершён, реализация не начата.
База: `cffcf96cc022d13c5e78221239eca94ef53dc725`, совпадает с GitHub main.
Рабочий checkout: Firebat1, `/opt/dev/system-integration/.local/structure`.

## 1. Вывод и границы

Оба приложения используют современную и подходящую задаче основу Spring Boot.
Повторная смена структуры, ORM или стека не требуется. План закрывает конкретные
дефекты HTTP-границ, остаточное разделение ответственности и небольшие
несоответствия текущим рекомендациям MVC и Java.

Сохраняем два процесса, Spring MVC/JDBC, domain/service/repository/controller,
существующие права, operationId, outbox, квитанции команд, историю и миграции.
Исходный объём задаёт `docs/original-specification.md`; архитектуру —
`docs/architecture.md`. Завершённый структурный рефакторинг не выполняем заново.

В этом документе P2 означает дефект или существенный риск надёжности,
P3 — сопровождаемость или приведение к современному штатному механизму.
Необязательные идеи вынесены отдельно и не блокируют выполнение основного плана.

## 2. Объём и доказательства повторного аудита

Проверены production-исходники обоих приложений: 61 Java-файл backend
и 18 Java-файлов emulator; application.yml обоих процессов; девять SQL-миграций;
корневые и модульные Gradle-файлы; generated API; Dockerfile и Compose.
Для 44 Java test-файлов проверены структура, сценарии, fixtures, подмены бинов
и разделение unit/PostgreSQL. Особое внимание — транзакциям, правам,
восстановлению, маппингу и фактическим HTTP-границам.

Свежий прогон на Firebat1:

~~~sh
export GRADLE_USER_HOME=/opt/dev/system-integration/.local/gradle
./gradlew --offline --no-daemon --max-workers=1 \
  '-Dorg.gradle.jvmargs=-Xmx512m -XX:ActiveProcessorCount=2' \
  :backend:test :emulator:test \
  :backend:dependencies --configuration runtimeClasspath \
  :emulator:dependencies --configuration runtimeClasspath
~~~

Результат: backend 87 unit-тестов, emulator 12; ошибок и пропусков нет.
Граф зависимостей подтверждает Boot 4.1.2, Framework 7.0.10,
Security 7.1.2 и HikariCP 7.0.2. Ручного переопределения Spring Framework нет.
Импортный анализ всех 79 production Java-файлов не выявил нарушения проверенных
границ domain/service/controller. Generated Java и реальные env-файлы не tracked.

Лог этого прогона — игнорируемый
`tests/results/spring-boot-audit-2026-11-14/gradle.log`.
Предыдущий адресный прогон из 27 тестов не прибавляется к 99:
это пересекающиеся проверки одного кода.

PostgreSQL, UI, recovery и NF08 в рамках повторного аудита не перезапускались.
Ошибки БД эмулятора и oversized-response оцениваются по коду; отказ работающей
БД и исчерпание памяти намеренно не воспроизводились. Старые результаты полной
квалификации не выдаются за свежие. CVE-аудит и security pentest сюда не входят.

## 3. Что проверено и не требует переписывания

| Область | Оценка и решение |
| --- | --- |
| Версии | Boot 4.1.2 — текущий stable; 4.2 RC не используем. Java 25 соответствует выбранному стеку. |
| Стартеры | webmvc, validation, actuator, security только в backend, flyway — по назначению. Собственный starter не нужен: переиспользуемой библиотеки здесь нет. |
| JDBC/DataSource | starter-flyway уже включает starter-jdbc/Hikari. Отсутствие второй прямой записи starter-jdbc не дефект. Автоконфигурация DataSource/JdbcTemplate/транзакций сохранена. |
| BOM и processors | Native Gradle platform управляет Spring-зависимостями. Версии annotation processors заданы отдельно, поскольку их configuration отделена от implementation. |
| Component scan | Application-классы находятся над собственными компонентами. Широкого component scan на соседние приложения нет. |
| DI и stereotypes | Controller, Service, Repository, Component используются по роли; production field injection не найден. JdbcUserDetailsService использует штатный UserDetailsService. |
| Конфигурации | Jackson настраивается через Boot customizer, а не заменой ObjectMapper. MapStructConfig — annotation processor contract, ему не нужен отдельный Spring bean. |
| Чистая модель | Domain не зависит от Spring, Jackson, JDBC, SecurityContext или generated API. Records и предметные методы остаются. |
| Транзакции | Прикладные операции — внешние вызовы proxied service. Внутренние вызовы apply/history уже находятся в транзакции; self-invocation здесь не используется для её открытия. |
| Сеть | ReconciliationService и ExchangeCoordinator выполняют HTTP между транзакциями. Добавлять на них blanket @Transactional нельзя. |
| Согласованность | Outbox/задание/история/квитанция и результат/курсор атомарны. REPEATABLE_READ у counted pages имеет конкретный смысл. |
| SQL и конкуренция | Параметры связаны, страницы ограничены, блокировки упорядочены, захват использует SKIP LOCKED; batch-публикация сохраняет курсоры по commit order. |
| Security | CSRF, session cookies, роли и ownership проверяются сервером. Специальный pre-CSRF filter сохраняет согласованный 401 при истёкшей сессии; удалять его без сохранения поведения нельзя. |
| Виртуальные потоки | HTTP virtual threads включены. Для независимых fixedDelay задач намеренно задан ThreadPoolTaskScheduler на два platform-потока. Это не ошибка и не кандидат на автоматическую замену. |
| Lifecycle | HTTP-клиент и executor переиспользуются и имеют close(). Не утверждаем утечку только потому, что ресурс создан внутри Spring bean. |
| Валидация | Jakarta validation плюс чистые domain-инварианты оправданы разными границами. Генератор сейчас оставляет @Validated на API — исправление ниже. |
| MapStruct/Lombok | Constructor injection, unmappedTargetPolicy=ERROR, один config на приложение. Не добавляем @Data в domain и интерфейсы каждому service. |
| Тесты | Unit-тесты отделены от реального PostgreSQL тегом postgres. Тестовые reset ограничены si_test/si_emulator_test. Field injection в test fixtures не приравнивается к production-дефекту. |
| Запуск | Flyway ведёт схему; demo-users и test-faults включаются профилями. Readiness включает БД. JVM non-root; graceful shutdown включён Boot по умолчанию, Compose даёт 60 секунд. |

## 4. Подтверждённые замечания

В сокращённых Java-путях `backend/` означает
`backend/src/main/java/com/azhukov/integration/`, `emulator/` —
`emulator/src/main/java/com/azhukov/emulator/`. Тесты находятся в соответствующем
`src/test/java` с теми же корневыми пакетами.

| ID | Приоритет | Факт и последствия | Владелец |
| --- | --- | --- | --- |
| SB-01 | P2 | GET /result-events без after возвращает Boot application/json без code вместо заявленного Problem. Недоступность БД эмулятора не отображается в заявленный 503 UNAVAILABLE. | emulator/exception/ApiExceptionHandler.java:29; contracts/external-exchange.openapi.yaml:78–113 |
| SB-02 | P2 | BodyHandlers.ofString() читает весь внешний ответ до проверки JSON/100 событий. Deadline не ограничивает число байтов; большой быстрый ответ способен исчерпать heap. | backend/client/http/HttpExternalExchangeClient.java:72–81 |
| SB-03 | P3 | JdbcReviewRepository.observe сам выбирает содержание события и пишет task_history, обходя общий afterCommit audit-log. У истории фактически два владельца. | backend/repository/jdbc/JdbcReviewRepository.java:63–74 |
| SB-04 | P3 | Generated API имеют @Validated, хотя Framework поддерживает встроенную MVC method validation; установленный generator 7.27.0 поддерживает useSpringBuiltInValidation. | build.gradle:50–60; generated internal/external API |
| SB-05 | P3 | Backend production source set включает external generated API/models, которые используются только тестами. В runtime попадает код без production-потребителя. | backend/build.gradle:29–35 |
| SB-06 | P3 | spring-security-test объявлен, но во всех backend/emulator test-файлах нет его импортов/использования. Добавлять вместо него новый test starter сейчас незачем. | backend/build.gradle:22 |
| SB-07 | P3 | Fixed pool из четырёх virtual threads дублирует ограничение pending.size()<4. Java рекомендует virtual thread на задачу; фактическое число одновременно начатых операций уже ограничено coordinator. | backend/service/ExchangeCoordinator.java:19–34 |

Для SB-01 проверка реального эмулятора показала: отсутствующий after даёт другой
формат, тогда как отрицательный after, limit=101 и неверный UUID дают ожидаемый
400 VALIDATION_FAILED. Это локальный дефект контракта, а не нарушение прав.
Отсутствие DB-to-503 mapping подтверждено кодом, а не остановкой демонстрационной БД.

## 5. Порядок реализации

| Этап | Содержание | Зависимость |
| --- | --- | --- |
| A | HTTP-ошибки и современная MVC-валидация: SB-01, SB-04 | Базовый код |
| B | Ограничение ответа и типизированная конфигурация: SB-02 | Базовый код; проверка ошибок из A |
| C | Один владелец истории: SB-03 | Базовый код |
| D | Production/test генерация и зависимости: SB-05, SB-06 | A для общей настройки generator |
| E | Virtual thread на задачу: SB-07 | B: сохраняются сетевые deadline |
| F | Общая квалификация, повторный аудит и актуализация документов | A–E |

Практический порядок — A → B → C → D → E → F.
Во время реализации выполняются только быстрые адресные проверки среза.
Один общий build/test/runtime/load milestone — после объединения A–E.

### A. Исправить HTTP-границу без нового framework ошибок

Файлы: оба `exception/ApiExceptionHandler.java`, `build.gradle`;
тесты `EmulatorWorkflowTest`, `HttpErrorRoutingTest`, `TaskWorkflowTest`,
`PaginationWorkflowTest`, `GeneratedContractTest`.

1. Добавить MissingRequestValueException в ошибки валидации эмулятора.
2. Преобразовать CannotCreateTransactionException и DataAccessResourceFailureException
   в 503 UNAVAILABLE, с безопасным диагностическим сообщением без SQL/credentials.
   Произвольную неожиданную ошибку не маскировать под недоступность БД или 400.
3. В общем configureContract включить useSpringBuiltInValidation=true.
   Убрать class-level @Validated посредством generator option, не ручной правкой
   build-файлов. Domain-валидацию и ограничения generated DTO сохранить.
4. Проверить оба варианта MVC input validation: MethodArgumentNotValidException
   и HandlerMethodValidationException. Если метод проверяет return value,
   его нарушение не должно превращаться в ошибку клиентского ввода 400.
5. Удалять старый обработчик ConstraintViolationException только после проверки,
   что ни один оставшийся runtime-путь его не порождает. Двойной механизм
   method validation специально не сохранять.
6. Оставить существующие generated Problem и форматы API.
   Не вводить общий BaseExceptionHandler между процессами. Отдельный переход
   всей обработки на ResponseEntityExceptionHandler для этого дефекта не требуется.

Недоступность хранилища проверять на изолированном стенде удержанием всех
соединений пула по существующему подходу DatabaseAvailabilityTest; не отключать
демонстрационный PostgreSQL. После освобождения пула штатный GET снова работает.

Критерий: отсутствие/неверный тип/границы query/header/body дают договорённый 400
и Problem; недоступное хранилище эмулятора — 503 UNAVAILABLE; неизвестная операция
— 404 OPERATION_NOT_FOUND. Положительные запросы, 401/403, CSRF и error dispatch
не меняются. Ошибки не создают операцию, outbox, квитанцию или историю.

### B. Ограничить внешний ответ и дать конфигурации одного владельца

Файлы: `backend/client/http/HttpExternalExchangeClient.java`,
небольшой bounded body subscriber в том же HTTP-пакете;
новые `config/ExchangeHttpProperties.java` и `config/ExchangeHttpConfiguration.java`;
`application.yml`, `HttpExternalExchangeClientTest`, новый `config/ExchangeHttpConfigurationTest.java` для binding/lifecycle.

1. Сохранить существующий JDK HttpClient и строгий ExchangeProtocol.
   Смена транспорта на RestClient сейчас не нужна для исправления размера ответа:
   она добавила бы проверку эквивалентности уже доказанного deadline всего тела.
2. Считать фактически полученные байты с остановкой/отменой при превышении.
   Проверка Content-Length может быть ранней оптимизацией, но не единственной
   защитой. Chunked и отсутствие длины также ограничиваются.
3. Начальный предел — 256 KiB: с запасом для страницы из 100 штатных результатов.
   Проверить этот запас реальной сериализацией максимального штатного payload.
   При несоответствии увеличить обоснованно до фиксации значения в конфигурации.
   Это предел протокольного сообщения, не SQL-бюджет и не лимит принятия заданий.
4. Один валидируемый ConfigurationProperties record хранит origin,
   connect timeout, полный response timeout и максимальный размер.
   Сохраняются значения 1 s / 2 s и действующий SI_EMULATOR_URL, связанный
   с новым свойством через YAML. Два конкурирующих источника URL не оставлять.
   Некорректные origin, отрицательные/нулевые параметры и небезопасно большие
   размеры отклоняются при старте с понятной ошибкой.
5. ExchangeHttpConfiguration с proxyBeanMethods=false регистрирует properties
   и единственный HttpClient bean. Клиент внедряется в HTTP-адаптер конструктором.
   Spring владеет его close(); старое создание/закрытие в адаптере удаляется.
   Pure bounded subscriber и ExchangeProtocol Spring-бинами не становятся.
6. Сохранить отличие definite connection failure от неопределённого исхода.
   Превышение размера не подтверждает приём/исполнение и не превращается
   в OPERATION_NOT_FOUND. Ошибка протокола и временный транспортный сбой
   должны оставаться различимыми; не сваливать все причины в status=0.
7. Configuration processor нужен только для metadata реально добавленных
   properties. Если он используется, его версия/платформа задаётся именно
   в annotationProcessor configuration, а не предполагается из implementation BOM.

Критерий: headers/body timeout, oversized Content-Length/chunked, отмена,
закрытие и повторное использование клиента проверены на локальном управляемом
HTTP-сервере. Штатная максимальная страница принимается. Нет молчаливого
обрезания JSON. После неоднозначного PUT остаётся тот же operationId и
уточняющий GET; локальное задание не теряется.

### C. Собрать историю у существующего владельца

Файлы: `service/IssueLifecycleService.java`, `repository/ReviewRepository.java`,
`repository/TaskRepository.java`, соответствующие JDBC-адаптеры;
`ExchangeWorkflowTest`, `RepositoryArchitectureTest`, SQL inventory/fixtures.

1. IssueLifecycleService выбирает нужную проблему и содержание наблюдения.
   ReviewRepository возвращает данные проблемы, а не записывает историю задания.
2. Специализированную запись observed_result перенести в TaskRepository/JDBC.
   Сохранить observation_fingerprint и ON CONFLICT: обычный history() её
   не заменяет. Новая запись возвращает факт вставки/ID для журналирования.
3. Общий небольшой private helper существующего JDBC-владельца регистрирует
   afterCommit log для реально добавленной истории. Не создавать event bus,
   generic audit framework или дополнительный сервис ради callback.
4. Удалить старые observe-вызовы и SQL из ReviewRepository/JdbcReviewRepository.
   Обновить SQL site identities и проверяющие ownership тесты.

Критерий: первое наблюдение даёт одно событие и audit-log с eventId после commit;
повтор не даёт второго события/ложного лога; rollback не даёт успешного лога.
Связь с проблемой и принятый результат не меняются. Миграция не нужна.

### D. Убрать test-only код из production-сборки

Файлы: `backend/build.gradle`, `build.gradle`, `tests/build/gradle.test.mjs`;
`GeneratedContractTest`, `ExternalDocumentCompatibilityTest`,
`OperationsWorkflowTest`; при необходимости `tests/build/context.test.mjs`.

1. В backend оставить internal API в sourceSets.main.
2. Сохранить генерацию external models для существующих контрактных тестов,
   но подключить её к sourceSets.test и compileTestJava через task provider.
   External server API-интерфейсы backend не нужны; для этой задачи генерировать
   только модели. В emulator external server API/models остаются в main.
3. Не копировать DTO вручную, не связывать backend с emulator JAR и не заводить
   shared-contract Gradle-модуль. Прежние проверки JSON и fingerprint остаются.
4. Удалить неиспользуемый spring-security-test из backend.
   При будущем реальном использовании @WithMockUser/@WithUserDetails подключать
   штатный spring-boot-starter-security-test; сейчас добавлять его незачем.
   junit-jupiter/spring-test уже входят в webmvc-test: дублирующие объявления
   можно убрать в этом же срезе, проверив testCompile/testRuntimeClasspath.
5. Расширить build graph test: backend bootJar не генерирует test-only external
   модели и не строит emulator; backend test генерирует их; emulator собирается
   независимо. Изменение external OpenAPI инвалидирует только потребителей.
6. Проверить содержимое backend JAR: external test-only модели и тесты отсутствуют.
   Internal generated API остаётся в JAR; generated source по-прежнему только build.

Критерий: тесты контрактов проходят, production потребители не потеряны,
адресная и чистая сборки воспроизводимы, нет исходников/generated артефактов в Git.

### E. Использовать virtual thread на отправку без второго ограничителя

Файлы: `service/ExchangeCoordinator.java`, `ExchangeCoordinatorTest`;
связанные threading/recovery проверки на итоговом milestone.

1. Заменить fixed pool virtual threads на thread-per-task executor
   с именованием delivery-. Число незавершённых заявок ограничивает уже
   существующий pending-loop; значение 4 имеет одного владельца.
2. Сохранить максимум 32 захвата за цикл, отсутствие preclaim без свободного
   слота, ожидание завершения отправленных peer-задач и передачу ошибок наружу.
3. Сохранить lifecycle owner и close(). Отдельный Executor bean, Semaphore,
   новый worker framework или @Async не нужны для одного потребителя.
   Не смешивать этот executor с applicationTaskExecutor Spring MVC.
4. Не менять два platform scheduler-потока, lease 15 s, DB pool и retry policy.

Критерий: четыре параллельные отправки максимум; медленный ответ не держит
свободные слоты; один упавший peer не теряется и не оставляет незавершённые
отправленные задачи. Контекст/worker закрывается без оставшихся delivery-задач.
Прирост производительности заранее не обещается; регрессия проверяется в F.

### F. Общая квалификация и финальный аудит

1. На Firebat1 проверить владельца изолированного system-integration-load,
   активные сборки/тесты и соединения с тестовыми БД. Не перезапускать демонстрацию.
2. Один раз на интегрированном кандидате выполнить unit + PostgreSQL-тесты обоих
   приложений, сборку обоих JAR, contract/build graph checks и проверку JAR.
   Полезные сценарии дополняют существующие тесты, не дублируют весь Spring.
3. Поднять изолированный кандидат штатным runner. Проверить роли, ownership,
   CSRF, create/replay/conflict, rename, доставку, ленту, лимит пяти попыток,
   сверку, применение решения, события наблюдения и восстановление после остановки.
4. Изменённые SQL и их варианты проверить EXPLAIN (ANALYZE, BUFFERS), записи —
   только в тестовой БД с WAL. Для перенесённого неизменного SQL подтвердить
   эквивалентность и обновить inventory; новые планы не подменять старыми.
   Конкурентные ожидания проверять отдельно от одиночного EXPLAIN.
5. Повторить одинаковый NF08-профиль: 5000 начальных записей, 20 клиентов,
   суммарно 2 CPU / 4 GiB. Сравнить API p95, очередь, скорость доставки,
   финальное отсутствие потерь/повторного исполнения и соблюдение 4 in-flight.
   Генератор на Firebat1 измеряет локальный путь, а не публичный HTTPS:
   место запуска обязательно записать в результат.
6. Повторный review итогового diff: слои, реальные bean dependencies,
   транзакционные proxy, один владелец настроек/истории/ограничения параллелизма,
   отсутствие старых путей и generated в src. Убедиться, что тесты проверяют
   поведение, а не только наличие аннотаций.
7. Актуализировать только затронутые решения в architecture/AGENTS/README и
   статус в current-stage. Приложить компактные результаты выбранного commit;
   текущие разделы этого плана не считать доказательством реализации.
8. Сформировать merge-ready результат после проверок. Merge и публичный deploy
   выполнять по соответствующему поручению. После разрешённого deploy отдельно
   сверить served artifact и проверить живое поведение; зелёные unit-тесты
   не заменяют этот этап.

Критерий: все A–E выполнены, общий gate зелёный, причины замечаний устранены,
runtime-контракты и данные сохранены. Незавершённый пункт остаётся незавершённым;
необязательные идеи из следующего раздела в критерий не входят.

## 6. Что не добавляем в обязательный объём

- RestClient вместо JDK HttpClient: допустимое последующее решение для общей
  Boot-конфигурации/SSL bundles/клиентских наблюдений. Если будет выбран, добавить
  starter-restclient и использовать Boot builder; сначала доказать прежний deadline
  всего тела и классификацию ошибок, затем полностью удалить старый транспорт.
  Два клиента и fallback-цепочка не допускаются.
- Micrometer-наблюдения исходящих запросов и метрики возраста очереди/paused feed:
  полезны при подключении реального мониторинга. Сейчас UI/история/логи уже дают
  эксплуатационный сценарий; новый monitoring stack не нужен. Временная
  недоступность исполнителя не должна делать локальное принятие задания unhealthy.
- Перестройка на feature-first, JPA, JdbcClient вместо JdbcTemplate, WebFlux,
  Redis, Kafka, Spring Batch/Modulith, новые процессы и собственные starters:
  конкретной потребности не найдено.
- @Bean для каждого stateless helper, интерфейс для каждого service,
  повсеместные @Validated/@Transactional/@Async и proxyBeanMethods-правки
  только ради количества аннотаций.
- Общие SQL-бюджеты, увеличение пулов/таймаутов или семафор поверх Hikari.
  Настройки производительности меняются по измеренной причине.
- CI: пользователь исключил его добавление. Проверки выполняются штатными
  проектными командами, без нового pipeline.

Отдельно установлен источник Gradle warning: Configuration.setVisible(boolean)
в org.openapi.generator; отчёт указывает удаление этого API в Gradle 11.
Это не доказательство поломки пользовательского build.gradle и не основание
срочно менять Gradle. Предупреждения Java относятся к generated моделям.
Не править generated вручную и не подавлять все предупреждения; обновление
generator допустимо при наличии исправления и отдельной контрактной проверке.

## 7. Данные, совместимость и поставка

Новых таблиц и миграций для A–E не требуется. Применённые миграции не меняются.
Форматы квитанций, канонический fingerprint, история и сохранённые JSON остаются
совместимыми. Внешние имена используемых env-переменных сохраняются.
Новый предел ответа документируется как транспортное ограничение.

Работа идёт в выбранном checkout; чужие dirty-файлы и соседние контейнеры
не затрагиваются. Проверки используют только выделенные test БД.
Production/demo reset, backup/dump, смена gateway/Xray или очистка данных
не нужны и этим планом не предписаны.

При последующем разрешённом релизе сохраняются точные предыдущие образы и
действующие runtime inputs; схема позволяет code rollback без сброса БД.
После проверки удаляются только собственные завершённые временные fixtures,
остаются компактные receipts. Публикация исходников и подтверждение работающей
демонстрации — разные результаты.

## 8. Официальные основания

Проверены для используемой линии Boot 4.1 / Framework 7.0 и установленного
OpenAPI Generator 7.27.0. Рекомендации применяются по назначению, не как
требование переписать всё под один шаблон.

- [Структура кода Spring Boot](https://docs.spring.io/spring-boot/reference/using/structuring-your-code.html)
- [Constructor injection и регистрация компонентов](https://docs.spring.io/spring-boot/reference/using/spring-beans-and-dependency-injection.html)
- [BOM и системы сборки](https://docs.spring.io/spring-boot/reference/using/build-systems.html)
- [Штатный JDBC и DataSource](https://docs.spring.io/spring-boot/reference/data/sql.html)
- [MVC built-in validation](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-validation.html)
- [Параметры Spring generator, включая useSpringBuiltInValidation](https://openapi-generator.tech/docs/generators/spring/)
- [ConfigurationProperties и внешние настройки](https://docs.spring.io/spring-boot/reference/features/external-config.html)
- [HTTP-клиенты Boot](https://docs.spring.io/spring-boot/reference/io/rest-client.html)
- [Task execution/scheduling и virtual threads](https://docs.spring.io/spring-boot/reference/features/task-execution-and-scheduling.html)
- [Java 25: virtual thread на задачу](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html)
- [Тестовые starter-модули Boot 4](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- [Graceful shutdown](https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html)
