# План: Spring Data JDBC для чтения и документация backend

Дата: 14.11.2026. Статус: SD-00–SD-06 выполнены и проверены.
Backend-кандидат — 891666d, итоговая интеграция с main — e0fdbbd;
результаты и границы доказательств —
в [текущей стадии](current-stage.md). Merge и deploy не выполнялись.
База: main `319067e79df02d61961d22e973513c46c5f3db64`.
Рабочая среда — Firebat1; публичный runtime остаётся на ac5c207.
План уточняет доступ к данным и сопровождаемость, не меняет исходное ТЗ.

## 1. Результат и выбранный подход

Для простого чтения вводим Spring Data JDBC. Явный Spring JDBC сохраняем
для конкурентных изменений, очереди, батчей и сложных SQL-проекций.
Это два механизма доступа к одной PostgreSQL, а не две копии данных.
Один DataSource, один менеджер транзакций и один актуальный путь каждого
пользовательского чтения. Hibernate/JPA, Redis и отдельная read-БД не нужны.

Фронтенд продолжает обращаться только к текущему OpenAPI через серверный API.
Он не получает Spring Page, persistence records или прямой доступ к репозиторию.
Текущая форма JSON, поля, коды ошибок, права и UTC-семантика сохраняются.

Выбор основан на форме запроса и гарантиях, а не на правиле «для UI Spring Data,
для нагрузки JdbcTemplate»: реестр UI сам входит в нагрузочный профиль NF08.
Не заявляем, что JdbcTemplate быстрее JPA: сравнительного замера ORM не было.
Для ручного SQL основанием бывают также блокировки, атомарность, сложность
mapping и отсутствие упрощения от генерации; не только скорость.

Альтернативы:

| Подход | Решение |
| --- | --- |
| Оставить всё на JdbcTemplate | Рабочий вариант с минимальным риском, но сохраняет ручной код простых выборок. Используем как измеренную базу сравнения. |
| Spring Data JDBC + существующий Spring JDBC | Выбран: стандартные репозитории для простых чтений, общие JDBC-транзакции, без persistence context и dirty checking. Потребуются небольшие записи хранения и mapping. |
| Spring Data JPA + Hibernate для чтения | Не выбираем: в текущем задании нет потребности в ORM-связях; добавятся модель persistence context и вопросы смешивания ORM с JDBC. |
| Массовая замена на JdbcClient | Не входит: меняет синтаксис ручного SQL, но не создаёт генерируемые репозитории и сама по себе не ускоряет БД. |

## 2. Факты исходного кода и границы переноса

На исходной базе 319067e Spring Data JDBC не был подключён. TaskRepository,
ExchangeRepository, ReviewRepository и CommandReceiptRepository имели JDBC-адаптеры.
TaskService обслуживал get/list/history и команды; JdbcTaskRepository объединял
чтение, изменения и запись истории. Domain оставался свободным от Spring.
В emulator OperationRepository имел один JdbcOperationRepository.
Эта исходная точка нужна для сравнения; текущие владельцы описаны в architecture.md.

| Сценарий и владелец до переноса | Цель | Причина и ограничение |
| --- | --- | --- |
| Карточка: TaskService.get → TaskRepository.get | Spring Data JDBC, запрос по id с owner для инициатора | Простое чтение одной строки. Чужой и отсутствующий id по-прежнему дают одинаковый 404. |
| Реестр: TaskService.list → list/countTasks | Spring Data JDBC через штатные Query/Criteria и JdbcAggregateOperations внутри read-адаптера | Динамические optional-фильтры не превращаем в десятки finder-методов. Обязательны SQL-планы и сравнение NF08. |
| История: TaskService.history → history/countHistory | Генерируемый Spring Data repository: taskId, Pageable, стабильный sort | Сначала проверка доступа к заданию; затем только ограниченная страница истории, без дочерней коллекции Task. |
| Изменения задания: insert/rename, проверки перед replay и lock-read | Существующий JDBC command-путь | Сохранить общую транзакцию с outbox, историей и квитанцией; не заменять на save всего read-record. |
| Запись history/observe | JdbcTaskRepository | Один владелец append-only записи, dedupe и afterCommit audit; Spring Data history только читает. |
| Список проблем: ReviewRepository.list/get | JdbcReviewRepository | JOIN задания/очереди, queueFree, nextAt и блокировка OF i для команд. Перенос в derived repository не упрощает запрос. |
| Сохранённая сверка и её batch-loading | JdbcReviewRepository | JSON snapshot + версия и существующая batch-выборка без N+1. Перенос сейчас не даёт необходимого упрощения. |
| Захват очереди, lease, попытки, курсор, idempotency receipts | JDBC-адаптеры backend | SKIP LOCKED, advisory locks, ON CONFLICT, проверки lease и атомарная фиксация. |
| Исполнение/публикация emulator | JdbcOperationRepository | Собственное состояние, блокировки, batch и порядок cursor по commit. Новый Spring Data starter в emulator без простого потребителя не добавляем. |
| Вход и создание demo users | JdbcUserDetailsService / DemoUsers | Существующий небольшой адаптер Spring Security; не смешиваем с изменением чтения заданий. |

Распределение внедрено в рабочей ветке; квалификация и итоговый аудит завершены.

## 3. Простая структура и правила

Сохраняем controller → service → repository. Добавляем один контракт
TaskReadRepository для get/page/history и его адаптер
SpringDataTaskReadRepository в repository/springdata. Он возвращает текущие
domain/dto-типы; сервисы не импортируют Spring Data, persistence records и Pageable.

В repository/springdata размещаем только используемые записи хранения
TaskReadRow и HistoryReadRow, узкие генерируемые интерфейсы для карточки/истории
и mapping к текущим Task/HistoryEntry. Отдельные каталоги model/converter вводим
только при реальном объёме; не создаём универсальный read-framework или
пустые service/manager/factory-слои.

Persistence records плоские: явные @Table/@Column/@Id для существующих имён,
UUID и timestamps; без истории/попыток/сверок как дочерних коллекций.
Для jsonb и UTC проверить реальную конвертацию PostgreSQL driver.
Существующие правила расшифровки accepted_result/details имеют одного владельца:
переиспользовать предметный mapping, если он нужен обеим реализациям,
а не копировать правила и не превращать domain в persistence entity.

Генерируемые read-репозитории расширяют минимальный Repository с нужными
find/count методами; save/delete и неограниченный findAll не публикуются.
Это ограничение интерфейса, не самостоятельная граница безопасности.
Не подключаем Spring Data REST и не экспонируем репозитории как HTTP endpoints.

TaskService сохраняет проверку page/size, UTC и прав и управляет транзакцией.
COUNT и строки реестра/истории находятся в одном REPEATABLE_READ snapshot.
Spring Data и JdbcTemplate используют один DataSource и одну внешнюю транзакцию.
Не создаём второй transaction manager и REQUIRES_NEW для read-вызовов.

Для реестра Query/Criteria строятся один раз из проверенных условий:
owner обязателен для инициатора; результат, начало >= и конец < добавляются
только при наличии. Count получает те же критерии без limit/offset/sort.
Сортировка фиксирована: created_at DESC, id DESC; у истории
occurred_at DESC, id DESC. Внешний произвольный Sort не принимается.
Используем актуальные findAll(Query, Class) + count(Query, Class);
deprecated перегрузку с отдельным Pageable не вводим.

Spring Data JDBC @Query не обеспечивает автоматический Pageable для строкового
SQL. Не переносим на него текущие запросы в расчёте на скрытое переписывание:
для сложного SQL используем явные limit/offset либо сохраняем JDBC.
Query by Example не используем для временного диапазона.
Если стандартное выражение реестра ухудшает SQL-план, сначала устраняем причину;
не добавляем fallback или скрытое переключение движков.

Текущие TaskRepository/JdbcTaskRepository после переноса теряют заменённые
list/count/history-read методы. Командные и блокирующие чтения остаются
для действительных command-consumers. Одинаковая таблица допустима;
два действующих UI-пути одного запроса — нет.

## 4. Javadoc: что именно документировать

Javadoc пишем для неочевидного контракта, а не для каждого getter.
Комментарий «для производительности» без конкретного механизма недостаточен.

| Место | Обязательное содержание |
| --- | --- |
| TaskReadRepository и read-адаптер | Область доступа, одинаковый 404, границы UTC, стабильный порядок, page/size, snapshot/count; почему выбран Spring Data JDBC. |
| TaskRepository / ExchangeRepository | Для каких методов обязательна транзакция, какие строки блокируются, порядок lock, различие UI-чтения и command-read. |
| JdbcExchangeRepository.lockDueExchange/startAttempt/ownsClaim и ExchangeService.claim/finish | SKIP LOCKED, срок lease, проверка владения попыткой, короткая транзакция; отсутствие HTTP под lock. |
| CommandReceiptRepository / IdempotencyService | Ключ actor+command+key, конфликт fingerprint, атомарность callback/save, replay без повторного эффекта и без расширения доступа. |
| JdbcTaskRepository.history / observe | Append-only, единственный SQL writer, dedupe, audit только после commit. |
| JdbcReviewRepository | Причина JOIN и batch вместо N+1, версия снимка, назначение lock-read, JSON snapshot и ограничения согласованности. |
| JdbcOperationRepository.publish / OperationService | Границы batch, атомарный cursor, порядок публикации, одно исполнение, сценарии удержанных событий. |
| ExchangeCoordinator / scheduler | Владение executor, закрытие, четыре in-flight, 32 claim за проход, независимость fixedDelay-задач; параметры не являются обещанием throughput. |
| HttpExternalExchangeClient / BoundedResponseBody | Общий deadline, лимит фактических байтов, типизированный oversized outcome, владение HttpClient; почему нужен этот небольшой адаптер. |
| ExchangeHttpProperties и параметры emulator | Единицы, defaults, допустимые значения и связь deadline с lease. |

Для публичных методов указываем @param/@return/@throws, когда это объясняет
предметный смысл. Переопределения используют @inheritDoc, когда контракт тот же.
У lock/batch-методов комментарий рядом с SQL объясняет то, что Javadoc
контракта не может показать. Ссылки ведут на архитектуру/проверки, а не на
машинные пути и временные отчёты.

## 5. Последовательность работ

Каждый этап заканчивается проверяемым сценарием. Точный ход выполнения и
квалификация фиксируются в current-stage.md; таблица сохраняет критерии приёмки.

| ID | Зависит от | Изменение и файлы | Приёмка |
| --- | --- | --- | --- |
| SD-00 | — | Зафиксировать исходную матрицу get/list/history: TaskService, JdbcTaskRepository, TaskRowMapper, текущие тесты/API и SQL-профиль. Проверить фактический dependency graph Boot BOM. | Определены точные поля JSON, null/enum/UTC, роли, filter/count/sort; сохранены базовые результаты и планы на тестовой БД. |
| SD-01 | SD-00 | В backend/build.gradle добавить starter-data-jdbc под текущим BOM, без отдельной версии Spring Data. Подключить TaskReadRow/узкий repository и один TaskReadRepository adapter. Перевести TaskService.get; сохранить command-read. | Карточка обеих ролей, чужой/отсутствующий id, terminal/null result и rollback работают на PostgreSQL; один DataSource/transaction manager, нет Hibernate. |
| SD-02 | SD-01 | Перевести историю на HistoryReadRow/repository внутри того же read-адаптера; обновить TaskService.history. Удалить старые history-read/count. | Права до чтения, все типы событий/details, count, пустая/последняя страница, одинаковое время с разными id; история не загружается целиком. |
| SD-03 | SD-02 | Перевести list/count на Query/Criteria в том же адаптере; удалить старые list/count/taskConditions, если потребителей больше нет. | Все комбинации owner/status/from/to, пустые результаты, UTC-границы, count snapshot и порядок совпадают; frontend-контракт прежний. |
| SD-04 | SD-03 | Javadoc из раздела 4; ArchUnit для repository/springdata, зависимости domain/service, отсутствия read-writes и persistence DTO в API. Небольшое улучшение Boot metadata, описанное ниже. | Javadoc/doclint проходят; архитектурная отрицательная fixture доказывает, что проверка замечает нарушение. |
| SD-05 | SD-04 | Согласовать architecture, AGENTS, README, test-cases, decomposition/roadmap/current-stage с фактической реализацией. Удалить заменённый код/тесты/документные противоречия. | Одна актуальная карта владельцев; исходное ТЗ и OpenAPI сохранены; план не выдан за внедрение. |
| SD-06 | SD-05 | Единый интегрированный gate и повторное ревью по разделу 7; подготовка поставки. | Код, SQL-планы, поведение, нагрузка и документы соответствуют одному commit. Merge/deploy выполняются только в порученном объёме. |

Во время реализации — адресные unit/PostgreSQL и compile-проверки затронутого
приложения. Полные сборки/UI/recovery/NF08 выполняются совместно после SD-05,
а не после каждого файла. Контролируем source, квалификацию и публичный runtime
как отдельные состояния.

## 6. Дополнительные предложения по Spring Boot

Включить в SD-04: configuration metadata processor только в backend, где уже
есть ExchangeHttpProperties. Версия — из согласованного BOM; annotationProcessor
конфигурация должна действительно получать эту версию. Javadoc полей становится
подсказкой IDE. Проверить metadata в JAR и отсутствие processor classes/dependency
в runtime. Не добавлять ручной metadata JSON без недостающих свойств.

Для нового Spring Data адаптера использовать автонастройку Boot. Собственную
@EnableJdbcRepositories/configuration добавлять только при подтверждённой
необходимости ограничить scan; не наследоваться от AbstractJdbcConfiguration
по привычке и не заменять Boot ObjectMapper/DataSource.

Предложения вне обязательного переноса:

| Предложение | Когда имеет смысл |
| --- | --- |
| Typed EmulatorProperties вместо единственного @Value | Если расширяется группа runtime-настроек emulator. Сейчас значение publicationBatch уже проверяется; это не текущая ошибка. Не делать отдельный класс только ради внешнего сходства. |
| Micrometer для глубины/возраста готовой очереди и latency обмена | Когда появляется потребитель метрик и способ просмотра. Предпочесть встроенные Boot/Micrometer примитивы; не строить мониторинговый стек в этой задаче. ID заданий, пользователей и операций не становятся metric labels. |
| Более точные startup/config tests | Добавить адресный тест на новый data-access wiring/metadata; существующие HTTP/PostgreSQL проверки не переписывать в slices ради формальности. |
| Именованные параметры в сложном ручном SQL | При содержательном изменении конкретного длинного запроса. Не заменять массово JdbcTemplate на новый фасад и не смешивать стили без причины. |

Сохраняем действующие constructor DI, MapStruct ERROR policy, чистый domain,
встроенную MVC-валидацию, внешние HTTP между транзакциями, ограниченные повторы,
virtual threads и явный scheduler. Они уже внедрены; повторная перепись не нужна.
Не добавляем generic CRUD, CQRS framework, event bus, JPA, второй пул/менеджер,
новые SQL-таймауты, кэш/Redis, новые миграции без изменения схемы или CI.

## 7. Проверки, риски и финальный аудит

- Контракт/права: два инициатора и оператор; одинаковый 404 для чужого и
  отсутствующего задания; прямые API-запросы, пустые данные, все статусы;
  Spring Data records и Page/Pageable не выходят за adapter.
- PostgreSQL: реальные UUID, jsonb, null, enum, UTC timestamps и сохранённые
  старые записи. Нет скрытых связанных загрузок и N+1. Для history и list
  одинаковые timestamps проверяются с разными UUID и границами страниц.
- Транзакции: согласованная counted-page при конкурентной вставке; отсутствие
  частичного задания/outbox/history/receipt при rollback; replay, rename и
  фоновое применение результата сохраняют свои прежние блокировки и ревизии.
  readOnly не считаем достаточной защитой от записи.
- SQL: получить фактически сгенерированные SELECT/COUNT; EXPLAIN
  (ANALYZE, BUFFERS) по ролям, комбинациям фильтров, пустым и глубоким страницам,
  history и JSON mapping. Сравнить планы, rows, buffers и время с SD-00.
  Изменяющие запросы — только на выделенных fixtures с rollback; demo не трогать.
  Обновить tests/sql/plans.py и README: сканер jdbc_inventory.py видит
  ручные JdbcTemplate-вызовы, но не доказывает покрытие generated SQL.
  Добавить явную связь read-сценариев с реально захваченными SQL/bind types
  и EXPLAIN, включая SQL Spring Data. В SqlWorkflowProfileTest проверить,
  что test-only наблюдение действительно видит generated запросы и COUNT;
  не считать уменьшение числа ручных JDBC sites уменьшением SQL-нагрузки.
  Если прежний AOP не покрывает внутренние вызовы, наблюдать test DataSource
  существующим подходящим механизмом, без production-зависимости и логов значений.
- Нагрузка: тот же NF08 — минимум 5000 исходных записей, 20 клиентов,
  суммарно 2 CPU / 4 GiB; p95 чтения <= 2 с, изменения <= 3 с.
  Тот же набор сценариев и одинаковая среда; ошибки не исключать.
  Проверить пул, ожидания lock, очередь, курсоры, однократность и целостность
  после drain. Отдельно показать latency внешнего завершения.
  Сравнение с предыдущими ~99/97 мс — ориентир, не новый договорный SLA.
- Источник нагрузки указывать явно: текущий генератор работает на Firebat1
  вне лимитов контейнеров, но на той же физической машине. Такой замер
  не является внешней сетевой нагрузкой или измерением публичного HTTPS.
- Сборка: оба JAR, generated контракты, корректные зависимости; targeted
  :backend:javadoc и :emulator:javadoc с doclint, без отключения проверок.
  Не требовать Javadoc на каждом очевидном accessor и сгенерированном коде;
  generated API не редактировать ради документации.
- Повторная квалификация: Java unit/PostgreSQL, API/UI desktop/mobile,
  recovery и чистый запуск по существующим runner-командам. Сравнить все
  D01–D07, NF01–NF10 и специальные D-NF требования с исходным заданием.
- Ревью: новый механизм уменьшает ручную работу, не добавляет параллельную
  read-модель хранения; domain не получил Spring annotations; нет bypass
  прав/транзакций, широкого save, старых UI SQL-путей и выдуманного выигрыша.
- Миграции не ожидаются: читаем текущую схему. Если mapping требует DDL,
  сначала пересматриваем mapping. Code rollback — предыдущие проверенные
  образы при неизменной схеме; выпуск и live-приёмка отдельным этапом.

При падении сравнения сначала определить причину: generated SQL, mapping,
N+1, count или транзакционный scope. Не увеличивать пулы/ресурсы и не скрывать
регрессию fallback. Если выбранный механизм требует несоразмерных обёрток,
пересмотреть конкретный read-сценарий и явно обновить этот план до продолжения.

## 8. Документы и источники

В этой итерации architecture/AGENTS описывают внедряемую структуру;
plan задаёт критерии, а current-stage отделяет адресные результаты от полного gate.
При реализации обновить таблицу владельцев и дерево packages в architecture,
правила backend AGENTS, команды/зависимости README, приёмку test-cases и статус.
Исходное ТЗ не редактировать и новые продуктовые требования ему не приписывать.

Официальные материалы, проверенные 14.11.2026:

- [Boot: SQL и поддерживаемые подходы](https://docs.spring.io/spring-boot/reference/data/sql.html).
- [Spring Data JDBC: derived queries, Page и ограничения @Query](https://docs.spring.io/spring-data/relational/reference/jdbc/query-methods.html).
- [Узкие Repository-интерфейсы](https://docs.spring.io/spring-data/relational/reference/repositories/definition.html).
- [Транзакции Spring Data JDBC](https://docs.spring.io/spring-data/relational/reference/jdbc/transactions.html).
- [Mapping и плоские записи хранения](https://docs.spring.io/spring-data/relational/reference/jdbc/mapping.html).
- [JdbcAggregateOperations: Query и count](https://docs.spring.io/spring-data/jdbc/docs/current/api/org/springframework/data/jdbc/core/JdbcAggregateOperations.html).
- [Boot configuration metadata processor](https://docs.spring.io/spring-boot/specification/configuration-metadata/annotation-processor.html).
