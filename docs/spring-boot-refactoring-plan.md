# Переход backend на явные Spring-слои

Дата исследования: 14 ноября 2026 года.
Статус выполнения — в [текущей стадии](current-stage.md#spring-слои--реализация).
Рабочая среда этой задачи — Firebat1 через SSH, выбранный checkout
в /opt/dev/system-integration/.local/structure. Локальную Mini-CRM не изменяем.

## 1. Основание и границы

Исходный объём задают [ТЗ](original-specification.md) и
[требования](requirements.md). Предыдущий R01–R09 завершён на 914ba38,
но не являлся переходом на пакеты controller/service/repository/mapper.
Публичный runtime и исходники main имеют отдельные состояния.

Перед этим планом подтянут origin/main 069825d. Merge 7bd41a7 объединил его
с R01–R09, сохранив адаптивную пагинацию, модальное создание, раскладку экранов
и split страниц. Незакоммиченная работа другого checkout не изменялась.
TypeScript, backend compileTestJava, шесть Select-тестов и сравнение AST
18 деклараций страниц прошли. Это scoped-проверки объединения, не полный gate.

Цель — предсказуемая навигация и ясные владельцы ответственности при сохранении
поведения, данных и проверенной архитектуры обмена. Число пакетов, аннотаций,
интерфейсов и строк не является самостоятельным критерием качества.

В объём входят backend, emulator, Java/OpenAPI build integration, связанные
тесты, SQL inventory, документация и инструкции. Frontend меняется только
при доказанной необходимости согласовать контракт или исправить регрессию.
Переход на JPA, новый брокер/кэш, новые сервисы и восстановление CI не входят
в этот рефакторинг. HTTP API и схема БД сохраняются.

## 2. Результат исследования

В проверенном backend 55 production Java-файлов и около 2 600 строк.
Контроллеры, Spring-сервисы и JDBC-репозитории уже существуют. Проблемы
сопровождения — роль в названии, расположение, смешение ответственности
и распределённое ручное преобразование HTTP DTO.

| Наблюдение | Решение |
| --- | --- |
| Контроллеры в web, сервисы в application, SQL в infrastructure/jdbc | Явные пакеты controller, service и repository/jdbc. |
| ExchangeTasks не обозначает Spring-сервис | ExchangeService с прежними транзакционными операциями. |
| IssueService меняет проблемы автоматически, ReviewService обслуживает оператора | IssueLifecycleService для первого; ReviewService остаётся владельцем операторского разбора. |
| TaskRepository реализует TaskStore и ExchangeStore | Разделить JDBC-реализации по заданиям/истории и состоянию обмена. |
| CommandReceipts.execute вызывает бизнес-callback внутри JDBC-класса | Координация идемпотентности — сервис; SQL lock/read/insert — репозиторий. |
| TasksController.view, ReviewViews и emulator Views преобразуют DTO вручную | MapStruct на HTTP-границе; вычисленные бизнес-решения остаются в domain/service. |
| Много ручных DI-конструкторов и logger | Lombok только для простого присваивания final-зависимостей и SLF4J. |
| SQL-планы и ArchUnit завязаны на FQN и имена методов | Обновлять владельцев и тестовый инструментарий вместе, без отключения правил. |

Размер TaskRepository — 260 строк: основание разделения — две обязанности,
а не условный лимит длины файла. Существующие records и инварианты полезны.

## 3. Источники и выбранный подход

Официальная документация проверена для используемых Spring Boot 4.1.2,
Spring Framework 7.0.10 и Gradle 9.9.1. Cached BOM Boot подтвердил Framework
7.0.10 и Lombok 1.18.48.

- [Spring Boot: структура кода](https://docs.spring.io/spring-boot/reference/using/structuring-your-code.html):
  единственная раскладка не требуется; пример группирует по предметным областям.
- [Spring Boot: SQL](https://docs.spring.io/spring-boot/reference/data/sql.html):
  JdbcTemplate/JdbcClient — штатные варианты рядом с ORM.
- [Spring: Transactional](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html):
  proxy перехватывает внешние вызовы; self-invocation не создаёт транзакцию.
- [MapStruct stable](https://mapstruct.org/documentation/reference-guide/) и
  [reference](https://mapstruct.org/documentation/stable/reference/html/):
  стабильная версия 1.6.3, Spring component model, constructor injection,
  проверка незаполненных target properties и Lombok binding.
- [Lombok Gradle](https://projectlombok.org/setup/gradle) и
  [changelog](https://projectlombok.org/changelog):
  1.18.48, compileOnly/annotationProcessor; поддержка JDK 25 присутствует.
- [Gradle Java plugin](https://docs.gradle.org/current/userguide/java_plugin.html):
  annotation processor path отделён от compile/runtime classpath.

В Java Agent дополнительно просмотрены общий MapStructConfig, зависимости
и примеры RequiredArgsConstructor/Slf4j. Переносим эти приёмы, а не его JPA-модель,
сервисы, конфигурацию runtime или все аннотации без разбора.

Выбор для этого небольшого сервиса — простая послойная раскладка с предметной
моделью внутри domain. Feature-first допустим по Spring; сейчас он хуже решает
запрос на единую очевидную навигацию по слоям. Новых Gradle-модулей по слоям нет.

## 4. Целевые владельцы и структура

~~~text
backend/src/main/java/com/azhukov/integration/
  SystemIntegrationApplication.java
  controller/
    TasksController.java
    OperationsController.java
    SessionController.java
  service/
    TaskService.java
    ExchangeService.java
    ExchangeCoordinator.java
    ReviewService.java
    ReconciliationService.java
    IssueLifecycleService.java
    IdempotencyService.java
  repository/
    TaskRepository.java
    ExchangeRepository.java
    ReviewRepository.java
    CommandReceiptRepository.java
    jdbc/
      JdbcTaskRepository.java
      JdbcExchangeRepository.java
      JdbcReviewRepository.java
      JdbcCommandReceiptRepository.java
      JdbcUserDetailsService.java
      TaskRowMapper.java
  mapper/
    TaskApiMapper.java
    ReviewApiMapper.java
  domain/
    task/
    exchange/
    review/
  dto/
    task/
    review/
  client/
    ExternalExchangeClient.java
    http/
      HttpExternalExchangeClient.java
      ExchangeProtocol.java
      ExchangeReply.java
  security/
  scheduler/
  config/
    MapStructConfig.java
    DocumentJsonConfiguration.java
  exception/
~~~

Дерево показывает основных владельцев, а не требование создать пустые каталоги.
Actor переносится в domain/Actor.java, RuleViolation остаётся в domain;
Page — в dto/Page.java. CreateTask, RenameTask и HistoryEntry переходят в
dto/task; IssueCommands — в dto/review, с прежними именами полей и nested
результатами. ContentFingerprint принадлежит техническому сценарию
service/idempotency; CommandType в dto сохраняет прежние строковые коды команд.
Пакеты common/utils для несвязанных классов не вводятся. В dto остаются только
реальные внутренние команды, результаты и проекции; HTTP DTO генерирует OpenAPI.

Эмулятор следует тем же названиям ролей, но не зеркалит каждый каталог:
controller, service, repository/jdbc, domain, mapper, config, scheduler,
exception. OperationStore становится контрактом репозитория, его реализация
остаётся единственной. Используемые контрактные пакеты не изменяются.

| Текущий владелец | Новый владелец |
| --- | --- |
| web/*Controller | controller/*Controller, прежние generated API interfaces |
| application/TaskService | service/TaskService |
| application/ExchangeTasks | service/ExchangeService |
| application/ExchangeCoordinator | service/ExchangeCoordinator |
| application/ReviewService | service/ReviewService |
| application/IssueService | service/IssueLifecycleService |
| application/ReconciliationService | service/ReconciliationService |
| TaskStore / ExchangeStore / ReviewStore | repository contracts TaskRepository / ExchangeRepository / ReviewRepository |
| infrastructure/jdbc/TaskRepository | JdbcTaskRepository + JdbcExchangeRepository |
| infrastructure/jdbc/ReviewRepository | JdbcReviewRepository |
| CommandReceiptStore + CommandReceipts | IdempotencyService + CommandReceiptRepository/JdbcCommandReceiptRepository |
| ExternalExchange + ExchangeClient | ExternalExchangeClient + HttpExternalExchangeClient |
| TasksController.view + ReviewViews | TaskApiMapper + ReviewApiMapper |
| emulator web/Views | mapper/OperationApiMapper |
| auth, infrastructure/scheduling, JSON configuration | security, scheduler, config по их фактической роли |
| web/ProblemResponses | exception/ApiExceptionHandler с прежним форматом для MVC и security |

## 5. Проверка простоты решений

- Сохраняем существующие содержательные границы хранения/HTTP. Не создаём
  интерфейс каждому сервису, ServiceImpl, BaseRepository или generic BaseMapper.
- Дополнительный ReconciliationTransactionService не нужен: уже есть
  ReconciliationService для HTTP между двумя вызовами ReviewService.
  Сохраняем эти два Spring bean и реальные транзакционные границы.
- Дополнительный UserRepository не нужен для этой задачи: JdbcUserDetailsService
  уже реализует штатную границу Spring Security. Его SQL остаётся в jdbc-пакете.
  Это адаптер UserDetailsService, возвращающий security principal, а не
  предметный репозиторий; его Spring Security-типы не проникают в domain/service.
- TaskRowMapper нужен двум JDBC-потребителям после разделения; это один реальный
  владелец разбора строки и JSON результата, не новый mapper framework.
- Репозитории не вызывают бизнес-callback. IdempotencyService выполняет его
  в транзакции вызывающего сценария; репозиторий предоставляет lock/find/insert.
- Контроллеры продолжают реализовывать существующие generated interfaces.
  Не делим один интерфейс между контроллерами с дублирующимися handler mappings.
- Предметные проверки не мигрируют в MapStruct, DTO или SQL-конструкторы.
- Переименованный путь удаляется вместе с обновлением реальных потребителей.
  Временная смесь перемещённых пакетов при разработке не содержит копий,
  runtime fallback или двух реализаций одного сценария.

## 6. Правила слоёв и Spring

Controller извлекает вход/actor, вызывает service, использует mapper и формирует
HTTP-ответ. В нём нет SQL, транзакционного сценария и решения бизнес-перехода.
Generated DTO принадлежат controller/mapper/client-http, не service/domain/repository.

Service владеет сценарием, правами и транзакцией, использует repository/client
contracts и domain. Domain хранит инварианты и переходы без Spring, JDBC,
Jackson и generated HTTP DTO. Репозиторий преобразует строки БД во внутренние
типы и выполняет SQL; не решает, какую бизнес-команду запускать.

Сохраняются один DataSource/transaction manager приложения, constructor injection,
readOnly/REPEATABLE_READ там, где они обеспечивают согласованные страницы,
и MANDATORY на операциях, которые обязаны присоединиться к уже открытой транзакции.
HTTP остаётся между короткими транзакциями. Coordinator сохраняет ограничения
параллелизма, порядок claim/HTTP/finish и закрытие executor/HttpClient.

История после commit продолжает логироваться после фактического commit.
Технические журналы сохраняют корреляционные ID, уровни и отсутствие секретов;
при переименовании logger-категорий обновляются реальные фильтры/профайлеры.

## 7. MapStruct, Lombok и генерация

Кандидат зависимостей: MapStruct 1.6.3, Lombok 1.18.48, binding 0.2.0.
Фактическая совместимость с Java 25, Jackson 3 и нашими generated моделями
закрывается чистой компиляцией в SP-01; исследование не заменяет этот gate.

Один MapStructConfig на приложение: componentModel spring, constructor injection,
unmappedTargetPolicy ERROR, подавленный generation timestamp. Backend и emulator имеют разные classpath,
поэтому владеют своими небольшими конфигурациями без общего JAR; версии
процессоров общие в корне Gradle. Мапперы описывают
реальные HTTP-проекции, вложенные поля, nullable-значения и enum/version.
Для умышленно отсутствующего target-поля нужен явный ignore с объяснением;
глобальное игнорирование новых target properties не используется.
Проверяются null/missing, версии и поле allowedActions. Применимость результата
и список разрешённых действий вычисляются существующей предметной политикой.
Строгий ExchangeProtocol продолжает проверять внешний JSON до принятия данных.

Lombok: RequiredArgsConstructor для конструкторов простого присваивания,
Slf4j для logger. Сохраняются явные конструкторы с валидацией и lifecycle-логикой.
Records остаются records; Data/Setter/Builder не открывают обход инвариантов.
Преобразования сохранённых JSON и ContentFingerprint не переписываются ради
аннотаций; golden fixtures проверяют прежний формат и тот же SHA-256.

Версии processor dependencies задаются явно из одного места: implementation BOM
не управляет annotationProcessor автоматически. Lombok — compileOnly и processor,
binding и MapStruct processor — только processor classpath. Test-конфигурации
подключаются при фактическом использовании аннотаций в тестах.

OpenAPI остаётся в build/generated/openapi владельца, MapStruct — в
build/generated/sources/annotationProcessor/java/main. Lombok изменяет compilation
AST; его результат — class-файлы build, а не добавляемые в src Java-копии.
Lombok/MapStruct processors не входят в runtime JAR. Дополнительный build plugin,
buildSrc и общий contracts JAR не требуются.

## 8. План с зависимостями

| ID | Работа и файлы | Зависимость | Проверка завершения |
| --- | --- | --- | --- |
| SP-00 | Подтянуть main и разрешить конфликты с R01–R09, сохранить новые UI/API page-size и документы. | Нет | Выполнено на 7bd41a7: TypeScript, compileTestJava, Select 6/6, AST 18/18. Общий gate предстоит. |
| SP-01 | build.gradle, backend/emulator build.gradle: processors, MapStructConfig, простые Lombok-применения. | SP-00 | Чистая адресная компиляция обоих приложений; Spring получает mapper beans; generated вне Git, processors вне bootJar. |
| SP-02 | Вертикальный сценарий задания: controller/service/repository contracts, разделение Task/Exchange JDBC и TaskRowMapper; TaskApiMapper. | SP-01 | Создание, повтор, переименование, страницы/size/фильтры, история и чужой ID сохраняют контракт. Пакетные SQL и транзакция создания не меняются. |
| SP-03 | Перемещение обмена: ExchangeService, Coordinator, client/http, scheduler, существующие domain-типы. | SP-02 | Claim/lease/finish, result/cursor, пять попыток, HTTP deadlines, батчи и resource lifecycle сохранены. |
| SP-04 | Операторский разбор/сверка: ReviewService, IssueLifecycleService, ReconciliationService и ReviewApiMapper. | SP-03 | Свежесть и версия сверки, права и конкурентные решения; HTTP вне транзакции, вызовы через Spring proxy. |
| SP-05 | IdempotencyService и чистый JDBC-репозиторий квитанций; security/config/exception по владельцам. | SP-02, SP-04 | Lock/read/callback/save атомарны; replay, другой input и другой actor различаются. 401/403/503 и ошибки API не изменились. |
| SP-06 | Эквивалентные слои emulator и OperationApiMapper; завершить перенос всех потребителей. | SP-01, SP-05 | Эмулятор собирается независимо, хранит своё состояние/события, исполняет операцию один раз. Старые пакеты и мапперы удалены. |
| SP-07 | ArchUnit, Java test packages, AOP profiles, tests/sql registry, AGENTS и текущее описание architecture. | Каждый срез; закрывается после SP-06 | Все сценарии обнаруживаются; негативные архитектурные примеры остаются красными; реестр SQL полный, ссылки/команды верны. |
| SP-08 | Единый полный gate, повторное ревью архитектуры/ТЗ, source delivery и cleanup. | SP-06, SP-07 | Все пункты разделов 9–11 подтверждены на одном коде, отчёты отделены от исторических. |

Во время реализации — быстрые проверки затронутого среза. Полные build/test,
Docker/UI/recovery/EXPLAIN/NF08 выполняются согласованно на SP-08. Более ранний
полный gate нужен только если дальнейшая безопасная работа без него невозможна.
Документация текущей структуры обновляется вместе с соответствующим кодом,
а окончательная архитектура заменяет прежнее описание, не создаёт вторую главу.

## 9. Регрессии и итоговый gate

Сначала собрать фактический список тестов на объединённой базе. Старые результаты
168 Java / 52 UI относятся к a5cde46 и не являются квалификацией 7bd41a7.
Сохраняются все новые сценарии main, включая adaptive-pagination и task-modal.

- Мапперы: значения всех контрактных полей, enum/version, null/missing,
  разрешённые действия и вложенные snapshots; через реальные generated impl.
- Архитектура: непустой импорт целевых пакетов; запрет SQL вне jdbc, HTTP DTO
  и JSON в domain, прямых JDBC-реализаций/HTTP-адаптеров в прикладных service.
  JSON-квитанция относится к техническому сценарию IdempotencyService;
  SQL по-прежнему только в repository/jdbc. Сохраняются плохие fixtures.
- PostgreSQL/API: права, версии/конкуренция, atomic task/outbox/history/receipt
  и result/cursor, предыдущие квитанции, rollback, 401/403/503, отказ чужому ID.
- UI: полный действующий набор на 390/1440 px, короткие окна, адаптивные page/size,
  модалки/Back/фокус/черновик, фильтры, UTC, приватный кэш и безопасный replay.
  Отдельный набор Select и проверка отсутствия fixtures в production assets.
- Recovery: все действующие сценарии, включая перезапуски API/БД/эмулятора,
  graceful stop, DNS backend, pool exhaustion и серии до/после пятой попытки.
- SQL: обновить имена call sites в tests/sql/plans.py при перемещении методов.
  Сохранить варианты ролей, sizes/offsets, COUNT, очереди, повторов и сверок.
  Старые ID не поддерживаются runtime aliases; coverage не уменьшается ради PASS.
  Сравнить реальные шаблоны/параметры до/после; EXPLAIN ANALYZE/BUFFERS,
  для применимых записей WAL — только на откатываемых тестовых fixtures.
- NF08: 5 000 завершённых исходных записей; 20 клиентов; 30 с прогрева и 120 с
  измерения; 2 CPU / 4 ГиБ на четыре контейнера. p95 чтения до 2 с, изменения
  до 3 с, ошибки/тайм-ауты включены. Внешнее исполнение, очередь и полная
  integrity-сверка показываются отдельно от p95 API.
- Чистый старт: четыре роли/БД, CONNECT isolation, миграции 7/2, три пользователя,
  шесть демосценариев и независимое подтверждение внешнего исполнения.
- Чистые независимые Gradle/Docker targets, актуальный codegen и инвалидация,
  сохранённые runtime config/dependencies кроме запрошенных библиотек.

Добавляем только тесты новых границ/рисков, не зеркала конструкторов, аннотаций
и простых перемещений. Существующие проверки не ослабляются из-за нового layout.

## 10. Данные, публикация и восстановление

Сохраняются девять применённых миграций без изменения байтов; новая миграция
для пакетов не нужна. Не меняются API paths/status/body, поля сохранённых
квитанций/результатов, алгоритм fingerprint, роли, ID операций, UTC и SI-10.
При переносе типов обновляются Jackson mixins и точные ссылки reflection/AOP.
Проверяется чтение старого JSON новым кодом, а не только новый round-trip.

Проверки выполняются на Firebat1 только в выделенном system-integration-load.
Перед владением стендом проверяются живые процессы, image revisions и test DB
principals; один прогон управляет им до завершения. Preview не является
самостоятельной причиной блокировать свободный тестовый слот.
Обычный runtime, данные, соседи и публичный туннель сохраняются.
Backups/dumps и копии рабочих БД этим планом не создаются.

Срезы оформляются логическими коммитами; task branch публикуется без force.
Исходники, результаты тестов, runtime-публикация и пользовательская приёмка
фиксируются отдельно. Merge в main и deploy не подразумеваются от одного
зелёного прогона: для них нужен соответствующий порученный объём.
Для последующего разрешённого deploy применяется квалифицированный артефакт
с отдельной проверкой URL/байтов; откат кода сохраняет БД и не включает
бесконечные повторы старых версий.

Завершённые test fixtures, тестовые контейнеры/том/сеть, временные contexts
и transport artifacts очищаются после сверки. Остаются выбранный source
workspace и компактные receipts с кодом/окружением/командами/результатами.

## 11. Критерий завершения и дальнейшая проверка

- В IDE очевидны controller, service, repository, mapper, client и domain.
  Имя класса соответствует роли, у каждого правила/состояния один владелец.
- Каждый вызов проходит через актуальный контракт. Заменённые Stores/Views,
  старые пакеты, дубли и fallback-пути отсутствуют.
- Сохранились границы, транзакции, данные и весь обязательный объём исходного ТЗ.
- MapStruct выполняет фактический mapping, Lombok убирает boilerplate;
  generated не закоммичен, processors не нужны runtime.
- Все обязательные проверки SP-08 проходят на итоговом коде; новые результаты
  не подменены исходными отчётами R01–R09 или UI.
- После зелёного gate выполнено отдельное итоговое code/architecture review:
  источники истины, реальные потребители, сложность, количество слоёв,
  публичные API, сохранённый JSON, SQL и тестовая полнота.
  Если оно выявляет причинный дефект, исправление и затронутые проверки
  выполняются до завершения, без автоматического переноса в будущую задачу.
- README/AGENTS/architecture/current-stage/roadmap/test-cases согласованы,
  task branch опубликована и сверена, cleanup подтверждён.

Обещание «идеальной архитектуры» заменено этими проверяемыми критериями.
Спорные решения пересматриваются по коду и фактам, а не ради числа слоёв
или формального наличия популярных библиотек.
