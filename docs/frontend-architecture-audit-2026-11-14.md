# Аудит архитектуры React frontend — 14 ноября 2026

Исторический срез: замечания ниже относятся к указанной версии, а не к текущему main.
Статус последующих исправлений — в [текущей стадии](current-stage.md) и
[плане frontend](frontend-refactoring-plan.md). Ссылки на удалённые исходники
закреплены на проверенном историческом коммите.
Итог последующего общего цикла — [аудит 15 ноября](iterative-audit-2026-11-15.md).

## Вывод

Текущий frontend имеет полезную основу: TypeScript strict, функциональные
компоненты, feature-каталоги, общий UI, generated OpenAPI-клиент, один QueryClient
и URL как источник фильтров. Переписывание приложения или смена стека не нужны.
Но границы ответственности закреплены слабее, чем в backend: инфраструктура,
сессия и предметные ключи собраны в app/api.ts, страницы одновременно управляют
чтением, командами, формами и представлением, а автоматических правил React
и зависимостей между каталогами нет.

Выявлены **два приоритетных дефекта P1**, семь замечаний P2 и два P3.
Самое существенное — при смене ID закэшированного задания React сохраняет
черновик формы другого задания. Это воспроизведено через Codex in-app Browser
на настоящем TaskCard с изолированными тестовыми данными, без записи в БД.
Вторая проблема — исключение рендера заменяет приложение стандартным экраном
React Router с техническим стеком вместо контролируемого восстановления.

Рекомендуемая основа: **app → features → shared**, предметные query/mutation
контракты рядом со сценарием, компоненты по поведению, явная идентичность формы,
один маршрутный конфиг и проверяемые правила зависимостей. Это проектное решение,
основанное на рекомендациях React и текущем масштабе, а не обязательная
«официальная структура каталогов React».

## Объём и доказательства

- Проверен main `6c335b65c82e35d5bfc95cb5c4d07ac4895618f8`.
- Среда исследования — локальный Windows workspace. Runtime и БД не изменялись.
- Изучены frontend/src, конфигурация генерации/сборки, клиентские тесты,
  компонентные fixtures, UI-сценарии, внутренний OpenAPI и backend-границы.
- Лексическая инвентаризация статических относительных импортов: 51 TS/TSX-файл,
  около 2,3 тыс. строк; четыре CSS-файла — около 1,2 тыс. строк. Generated-клиент,
  тесты и зависимости в эти числа не входят. Число строк не служит оценкой качества.
- В src/app — 10 TS/TSX-файлов, features — 12, ui — 27; остальные — main и vite-env.
- Файловых циклов в проверенных статических импортах не найдено. Это не проверка
  произвольных динамических импортов или доказательство корректности всех слоёв.
- Свежие проверки аудита: TypeScript и 12 unit-тестов прошли; пять изолированных
  Node-проб подтвердили поведение HTTP-декодирования, mutation callbacks
  и перечитывания infinite query. IAB подтвердил перенос черновика между ID.
- Предыдущий полный gate на `73638eb`: production build, 12 unit + 2 asset,
  10 компонентных и 74 UI-проверки. Frontend/tests/contracts в исследуемом main
  совпадают с этим кандидатом. Полный gate в ходе аудита не повторялся.
- Временная browser-fixture закрыта и убрана из frontend; её копия, снимок,
  inventory и результаты проб сохранены в ignored
  `tests/results/frontend-architecture-audit/`.

Исследование не вносит исправления production-кода. Инвентаризация, чтение
библиотек и контролируемые пробы не заменяют проверку каждого будущего исправления.
Визуальный аудит всех устройств, измерения React Profiler и проверка CVE отдельно
не выполнялись; выводы о производительности ниже отделены от измеренной задержки.

## Стек и применимость источников

Версии сверены по установленным package.json, а не только диапазонам manifest.

| Зависимость | Установлено | Значение для решения |
| --- | --- | --- |
| React / React DOM | 19.3.1 | Рассматриваются современные Hooks, StrictMode и identity/state правила React 19. |
| React Router DOM | 7.18.5 | Проверены именно документы 7.18.5 и установленный production fallback. Рекомендации Router 8 не переносились автоматически. |
| TanStack Query | 5.107.1 | Server state остаётся у Query; доступны queryOptions, infiniteQueryOptions и штатная отмена. |
| TypeScript | 7.0.2 | Strict уже включён; совместимость будущего ESLint toolchain необходимо проверить на этой версии. |
| Vite | 8.3.8 | Существующий SPA build подходит; смена сборщика не обоснована. |
| Orval | 8.47.0 | Контракт генерируется в build/generated; транспорт исправляется конфигурацией/расширением генератора. |

Официальные рекомендации дают следующие основания:

| Практика | Применение здесь | Первичный источник |
| --- | --- | --- |
| Компоненты выделяются по ответственности и данным | Отделить форму, фильтры и историю там, где у них собственное поведение; число строк не является правилом декомпозиции. | [Thinking in React](https://react.dev/learn/thinking-in-react), [Importing and Exporting Components](https://react.dev/learn/importing-and-exporting-components) |
| Минимальное состояние без копий производных данных | Query хранит серверные записи, URL — фильтры, форма — свой черновик. | [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) |
| Состояние связано с позицией и identity компонента | При смене taskId нужен сброс предметной формы; обновление той же записи не должно стирать черновик. | [Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state) |
| Hooks выражают повторяемое поведение | Выделять сценарии и подписки, а не механически переносить каждую строку useQuery в обёртку. | [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) |
| Effects синхронизируют внешние системы | Observer, matchMedia и storage — законные внешние границы. Производные списки не надо хранить через Effect. | [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) |
| DOM-измерение допускает layout effect, внешние подписки имеют cleanup | Сохранить штатные механизмы usePageSize и useMediaQuery. | [useLayoutEffect](https://react.dev/reference/react/useLayoutEffect), [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) |
| React-правила должны проверяться инструментами | Добавить совместимые Hooks lint rules и StrictMode в dev/test. | [eslint-plugin-react-hooks](https://react.dev/reference/eslint-plugin-react-hooks), [StrictMode](https://react.dev/reference/react/StrictMode) |
| Route Objects дают границы и lazy-модули | Использовать имеющийся Data Router как владельца маршрутов; React Query остаётся владельцем данных. | [Router 7.18.5: Route Object](https://reactrouter.com/7.18.5/start/data/route-object), [Error Boundaries](https://reactrouter.com/7.18.5/how-to/error-boundary) |
| key и queryFn удобно хранить вместе | Предметные queryOptions рядом с feature используются и страницей, и prefetch. | [TanStack Query Options](https://tanstack.com/query/latest/docs/framework/react/guides/query-options) |
| Infinite refetch перечитывает загруженные страницы последовательно | Нужен явный бюджет истории, а не предположение, что polling стоит один запрос. | [Infinite Queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries) |

## Что стоит перенять из backend

У backend дело не только в названиях папок. В
[backend/AGENTS.md](../backend/AGENTS.md) закреплены владельцы, направление
зависимостей и границы DTO. Эти правила подтверждаются
[DomainArchitectureTest](../backend/src/test/java/com/azhukov/integration/domain/DomainArchitectureTest.java)
и [ServiceArchitectureTest](../backend/src/test/java/com/azhukov/integration/service/ServiceArchitectureTest.java),
включая отрицательные fixtures: тест доказывает, что запрещённая зависимость
действительно будет отклонена. Это сильнее соглашения «класть код аккуратно».

Трасса создания задания читается как controller → mapper/service → domain и
repository/client. См.
[TasksController](../backend/src/main/java/com/azhukov/integration/controller/TasksController.java),
[TaskService](../backend/src/main/java/com/azhukov/integration/service/TaskService.java),
[TaskApiMapper](../backend/src/main/java/com/azhukov/integration/mapper/TaskApiMapper.java)
и [TaskRepository](../backend/src/main/java/com/azhukov/integration/repository/TaskRepository.java).
Это проверка выбранных границ для сравнения, не повторный полный аудит backend.

| Принцип backend | Соответствие во frontend | Что не следует копировать |
| --- | --- | --- |
| Тонкий controller | Route/page собирает экран и связывает действия. | HTTP-контроллеры или серверный DI в браузере. |
| Сценарий в service | Предметная mutation/model функция управляет командой, её receipt и обновлением чтений. | Класс Service и интерфейс на каждый endpoint. |
| Один SQL/HTTP-владелец | Один generated transport, одни query options/keys для предметного чтения. | Дополнительный repository, лишь пересылающий вызов Orval. |
| Domain без инфраструктуры | Чистый TS для разбора фильтров и отображения; версии/права/переходы остаются серверными. | Копию backend domain с самостоятельными правами и переходами. |
| Явные mapper | Formatter/view model только там, где представление отличается от DTO. | Зеркальную модель с переименованным полем для каждой API-схемы. |
| Architecture tests | Проверяемые import boundaries и React lint. | Ограничение, проверяемое только названием каталога. |

## Реестр замечаний

P1 — исправить до дальнейшего расширения поведения; P2 — необходимая работа
над фундаментом; P3 — локальное упрощение или оптимизация после основных границ.
Приоритет здесь не означает наличие подтверждённой уязвимости сервера.

| ID | Приоритет | Вид | Замечание |
| --- | --- | --- | --- |
| FA-01 | P1 | Воспроизведённый дефект | Черновик переименования переживает смену taskId. |
| FA-02 | P1 | Подтверждено конфигурацией и исходником Router | Нет собственной границы ошибок рендера. |
| FA-03 | P2 | Подтверждено кодом и библиотечной пробой | Подтверждённая команда смешана с ошибкой последующего чтения. |
| FA-04 | P2 | Воспроизведено на generated transport | Не-JSON ошибка теряет HTTP status; пустой 200 становится пустым DTO. |
| FA-05 | P2 | Архитектурный долг | app одновременно является composition root и общим нижним слоем. |
| FA-06 | P2 | Архитектурный долг | Маршруты спрятаны в descendant Routes, все страницы импортируются сразу. |
| FA-07 | P2 | Пробел защитных проверок | Нет React lint, StrictMode и проверяемых границ импортов. |
| FA-08 | P2 | Подтверждено кодом | Защита dirty/pending форм различается между сценариями. |
| FA-09 | P2 | Подтверждённая модель стоимости, риск роста | История перечитывает все загруженные страницы при polling. |
| FA-10 | P3 | Связность и механизм оптимизации | Общий query wrapper зависит от HistoryPage и разворачивает весь result. |
| FA-11 | P3 | Архитектурный долг | CSS оболочки содержит оформление всех feature-экранов. |

### FA-01. Идентичность формы не следует за идентичностью задания

**Источник:** [task-details.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/features/tasks/task-details.tsx),
строки 29–84: TaskCard хранит editing, RenameForm получает изменяемый task,
но фиксирует revision через useState и заполняет uncontrolled input через
defaultValue. Ключа по taskId на предметной границе нет.

**Подтверждение:** fixture монтирует реальный TaskCard, заранее кладёт A и B
в настоящий QueryClient и меняет параметр одного маршрута. После ввода
«Черновик для A» и перехода к B DOM показывает заголовок «Задание B»,
заявку REQ-000002 и прежний черновик A. У A revision=1, у B revision=7.
Снимок и JSON сохранены в cached-task-draft.*; сохранение не нажималось,
fixture отклоняет все записи и не обращается к backend.

Такой переход проверяет именно смену :id без промежуточного размонтирования,
в том числе возможный history jump к закэшированному экрану. Fixture не доказывает,
что в текущем UI существует отдельная ссылка «A → B». При холодном кэше Loading
размонтирует форму, поэтому обычная проверка только незакэшированной записи
может скрыть проблему.

**Последствие:** по коду форма использует taskId уже B, но revision и черновик A.
Разные версии могут дать ложный конфликт; одинаковые версии допускают отправку
не того названия в B. Последнее — вывод из кода команды, не выполненная запись.

**Минимальная коррекция:** задать identity предметной части экрана/формы по
taskId. При смене ID сбрасываются editing, черновик и зафиксированная версия.
Не ставить key по titleRevision: обычный refetch той же записи не должен
стирать черновик и незаметно заменять expectedTitleRevision последней версией.

**Проверка:** A/B с тёплым и холодным кэшем, одинаковыми и разными revision;
отдельно background refetch того же A во время редактирования. Эта проблема
уже присутствует в `319067e`; frozen revision/defaultValue были и в `069825d`.
Она не объясняется только последним изменением мобильного layout.

### FA-02. Исключение рендера уводит в стандартный технический экран

**Источник:** [main.tsx](../frontend/src/main.tsx):11 и
[App.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/app/App.tsx):84. У единственного route object нет
ErrorBoundary/errorElement; ErrorMessage отображает ошибки запросов и не ловит
исключения дочернего React-дерева.

Установленный production-код React Router 7.18.5 в DefaultErrorComponent
выводит Unexpected Application Error, message и stack. Поэтому отсутствие своей
границы не равно отсутствию любого catch: catch есть, но результат неуправляем
для продукта и заменяет всю оболочку.

**Коррекция:** корневая безопасная fallback-страница и вложенная граница области
экрана, сохраняющая навигацию. Разделить ошибки рендера, ожидаемые API-ошибки
и ошибки событий/команд. Не показывать raw stack или бизнес-payload пользователю.
Не превращать ошибки в пустой успешный список.

**Проверка:** намеренное исключение компонента и ошибка lazy chunk; восстановление
или уход на другой экран. Отдельно 401/403/404/409/5xx должны оставаться
предметными состояниями, а не падением всего дерева.

### FA-03. Успех команды зависит от последующего сетевого чтения

**Источники:** [task-create.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/features/tasks/task-create.tsx):27,
[task-details.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/features/tasks/task-details.tsx):76,
[reconcile-button.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/features/operations/reconcile-button.tsx):16,
[use-refresh-exchange.ts](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/features/operations/use-refresh-exchange.ts):6.
В onSuccess ожидаются fetchQuery и/или invalidateQueries с throwOnError.
Очистка формы, receipt/key и переход выполняются после этих чтений.

В пробе на установленном MutationObserver успешный mutationFn выполнился один
раз, но исключение onSuccess перевело mutation в error. Это ожидаемое поведение
библиотеки. Ошибка принадлежит прикладному контракту: UI не отделяет
«команда подтверждена, обновить экран не удалось» от «результат команды неизвестен».

**Коррекция:** хранить подтверждённый результат команды как подтверждённый;
показывать ошибку актуализации отдельно и повторять чтение. Для действительно
неопределённого исхода записи сохранить повтор с тем же idempotency key.
Ожидание Promise в onSuccess само по себе корректно; простое удаление await
с игнорированием ошибок также не решает задачу.

**Проверка:** 201/200 команды, затем 502 чтения — один POST/PATCH, явное
подтверждение и retry чтения. Соседний случай — потерянный ответ записи:
повтор команды с прежним ключом без второго бизнес-эффекта.

### FA-04. Ошибка декодирования теряет транспортную семантику

**Источники:** [orval.config.ts](../frontend/orval.config.ts),
[api.ts](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/app/api.ts):21–24,67–76; generated getTask декодирует
JSON.parse до возврата status. Generated-файл является результатом, не местом
ручного исправления.

**Пробы:** ответы 401 и 502 с HTML дали SyntaxError без status. data() не получает
HTTP-ответ, expireSession видит только ошибки ApiError(401), а не этот случай.
Пустое тело 200 превратилось в data={}, хотя обязательные поля Task отсутствуют.
Это проверка искусственных ответов; несоответствие текущего backend контракту
этим не установлено. Статическая типизация generated DTO не валидирует JSON.

**Коррекция:** одна транспортная граница, сохраняющая status и различающая
сетевую ошибку, HTTP-ошибку и нарушение успешного контракта. Использовать
штатный custom client/mutator Orval, предварительно проверив конфигурацию
8.47.0 по [документации генератора](https://orval.dev/docs/guides/custom-client/).
Успешное отсутствие обязательного тела не должно становиться фиктивным DTO.
Полная новая validation-библиотека для каждого ответа не является обязательной.

**Проверка:** JSON problem 401/409, HTML 401/502, пустой 200, корректный 204,
валидный DTO и AbortError. Сбой чтения не должен запускать повтор записи.

### FA-05. app — одновременно верхний и нижний слой

**Источники:** [api.ts](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/app/api.ts),
[use-collection-query.ts](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/app/use-collection-query.ts),
[task-list.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/features/tasks/task-list.tsx),
[feed-footer.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/ui/feed-footer.tsx):2.

В app/api.ts находятся transport errors/data(), CSRF, ключи всех предметных
областей, session lifecycle и QueryClient. Features делают 34 относительных
импорта из app; app импортирует шесть feature-страниц. UI-компонент FeedFooter
также зависит от app/error-message. Это семантическая зависимость слоёв в обе
стороны; файлового import cycle инвентаризация не обнаружила.

TaskList объединяет разбор URL, валидацию, запрос, desktop/mobile представление,
фильтры и модалку; TaskCard — чтение, переименование и историю. Наличие useQuery
в компоненте допустимо в React. Проблема здесь в нечётких владельцах поведения
и невозможности проверить их независимо, а не в нарушении универсального правила.

**Коррекция:** app оставить composition root; transport/common hooks/UI перенести
в shared, session policy — к auth, предметные keys/queryOptions/команды — к feature.
Самостоятельные формы, фильтры и история получают файлы по их жизненному циклу.
Query key и queryFn одного чтения хранятся вместе и используются также prefetch.
Типовые трёхстрочные компоненты не требуют собственного model/service слоя.

15 модулей импортируют generated типы и/или функции. Сам импорт DTO не дефект:
при неизменном представлении разрешено использовать generated тип напрямую.
Отдельная модель нужна только при реальной разнице UI и контракта.

### FA-06. RouterProvider скрывает внутри себя второе описание маршрутов

**Источники:** [main.tsx](../frontend/src/main.tsx):11,
[App.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/app/App.tsx):20–25,84–93.
Data Router знает один wildcard, а настоящие URL и роли описаны в descendant
Routes. Такая комбинация работает, в том числе для useBlocker, но лишает
реальные страницы route-level data/lazy/error границ Data Router.
Это прямо оговорено в [Routes 7.18.5](https://reactrouter.com/7.18.5/api/components/Routes).

Все шесть страниц импортируются статически. У существующей квалифицированной
сборки один JS около 527 kB minified / 162 kB gzip. Это размер артефакта,
а не измерение плохой скорости на телефоне.

**Коррекция:** один route-object конфиг в app/router.tsx, auth/role layout,
дочерние страницы, их fallback и lazy при необходимости. Сохранить текущие URL,
modal route /tasks/new, focus, blocker и ScrollRestoration. Данные остаются
в React Query; вводить параллельный loader-кэш не требуется. Если позже нужен
prefetch из loader, он использует тот же QueryClient и те же queryOptions.

### FA-07. Хорошие соглашения не защищены автоматическими проверками

**Источники:** [package.json](../frontend/package.json):10–16,
[tsconfig.json](../frontend/tsconfig.json), [main.tsx](../frontend/src/main.tsx):19.
Есть strict typecheck и тесты, но нет ESLint-конфигурации/dependency/scripts,
StrictMode и frontend import-boundary gate. Нарушения Hooks нельзя надёжно
отловить одним tsc. Отсутствие линтера само по себе не доказывает существующего
нарушения порядка Hooks; такой дефект при чтении не установлен.

**Коррекция:** совместимый с TypeScript 7 lint toolchain с React Hooks rules,
разумными Query rules и точечными
[ограничениями импортов](https://eslint.org/docs/latest/rules/no-restricted-imports).
StrictMode включать в development/компонентных проверках, исправляя нарушения
cleanup, а не отключая проверки ради прежнего числа вызовов.

Правила зависимостей должны проверять реальные imports, type-only импорты,
публичные входы и отрицательный fixture. Не нужен новый architecture framework,
если существующий линтер закрывает эти требования.

### FA-08. Жизненный цикл изменяемых форм не согласован

**Источники:** [task-create.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/features/tasks/task-create.tsx):35–43,
[issue-details.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/features/operations/issue-details.tsx):112–140,
[task-details.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/features/tasks/task-details.tsx):82–88.

NewTask защищает dirty/pending через useBlocker/useBeforeUnload и блокирует
поля. DecisionForm хранит причину и действие, но не защищает навигацию/перезагрузку,
включая уход во время отправки. RenameForm не блокирует input и отмену во время
запроса. Ранее замеченный UX-03 остаётся актуальным по текущему коду.

**Коррекция:** общая небольшая политика dirty/pending/accepted для реально
изменяемых форм с сохранением локального владельца черновика. Переиспользовать
существующие Router blocker и DiscardDialog. Учитывать, что у маршрутизатора
должен оставаться один активный владелец блокировки, а не несколько конкурирующих
глобальных обработчиков. Черновик не переносить в QueryClient или localStorage.

**Проверка:** ссылка, browser Back/Forward, reload, pending и ошибка команды;
подтверждение отказа и возврат фокуса. Безопасный уход не отменяет уже
подтверждённую сервером команду.

### FA-09. У бесконечной истории отсутствует бюджет перечитывания

**Источники:** [use-collection-query.ts](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/app/use-collection-query.ts):12–27,
[task-details.tsx](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/features/tasks/task-details.tsx):92–97 и
[refresh-interval.ts](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/features/tasks/refresh-interval.ts).
История опрашивается каждые 3 или 10 секунд. Infinite query хранит все страницы
и при refetch последовательно перечитывает их. В изолированной пробе пять
загруженных страниц дали пять чтений на один refetch. Это подтверждённая модель
стоимости, но задержка или утечка памяти на production не измерялись.

**Коррекция:** определить ожидаемую длину истории, бюджет сетевых чтений,
числа DOM-элементов и сохранённой позиции; измерить длинный сценарий. Затем
выбрать bounded window с загрузкой в обе стороны либо иной явно описанный
контракт истории. Виртуализация уменьшает DOM, но сама не уменьшает refetch.
maxPages без навигации к вытесненным страницам нарушит доступность старой истории.

Map по ID убирает дубликат на границе offset-страниц, но не создаёт snapshot
или cursor consistency. Параллельные изменения списка и стабильная пагинация
требуют отдельного API-решения; маскировать это дописыванием локального массива
поверх Query нельзя. Изменение backend API — отдельный согласованный этап.

### FA-10. Общий wrapper несёт лишнюю связь с предметным DTO

**Источник:** [use-collection-query.ts](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/app/use-collection-query.ts):2–5,25–27.
Универсальная коллекция описана через Omit<HistoryPage, 'items'>, хотя обслуживает
и задачи, и разборы. Возвращается spread всего query result, а массив строится
заново при каждом вызове.

**Коррекция:** небольшой общий контракт страницы либо структурный generic,
сохраняющий совместимость generated ответов; query result и проекцию коллекции
выдавать явно, не копируя все наблюдаемые свойства. Стабилизировать вычисления
только там, где это помогает реальным потребителям.

Это локальное упрощение и риск лишних rerender, не доказательство наблюдаемой
медленной работы. Обоснование механизма отслеживаемых свойств —
[TanStack Render Optimizations](https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations).

### FA-11. Оформление feature-экранов принадлежит app/styles.css

**Источники:** [styles.css](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/app/styles.css):28–75,110–169,
[patterns.css](https://github.com/FerrPOINT/system-integration/blob/6c335b65c82e35d5bfc95cb5c4d07ac4895618f8/frontend/src/ui/patterns.css). Общие tokens/controls отделены
и происхождение Base документировано — это стоит сохранить. Но файл оболочки
также управляет task/issue tables, snapshots, фильтрами, историей и мобильной
композицией всех сценариев.

**Коррекция:** глобальный reset/theme и shell оставить общими, feature layout
разместить рядом со своим экраном, primitive-варианты — рядом с UI. Начать
с текущего CSS и scoped имён; CSS Modules нужны при реальной необходимости
жёсткой изоляции. Замена всей системы на Tailwind/CSS-in-JS не обоснована.
Не менять поведение copied Base компонентов одновременно с переносом файлов.

## Предлагаемый фундамент

### Выбор структуры

| Вариант | Оценка для этого приложения |
| --- | --- |
| Оставить всё внутри файлов страниц | Минимальная цена сегодня, но смешение API, форм и route identity уже скрывает дефекты. |
| Глобальные components/hooks/services/types | Видны технические типы файлов, но один сценарий разъезжается по всему проекту; трудно определить владельца. |
| app + предметные features + shared | Рекомендуется: понятная точка входа, сценарий находится рядом со своими API/state/UI, общий слой не знает приложение. |
| Полная многоуровневая схема с entities/widgets/pages и DI | При 51 TS/TSX-файле дополнительная стоимость пока не обоснована. Вводить слой по появившейся ответственности. |

Пример целевой структуры, не обязательный список файлов для механического
создания. Маленькие части можно оставить вместе, пока это не смешивает владельцев.

```text
src/
  main.tsx
  app/
    app.tsx
    router.tsx
    providers.tsx
    root-error-boundary.tsx
    shell/
      app-shell.tsx
      app-header.tsx
      brand.tsx
      theme.tsx
      shell.css
  features/
    auth/
      api/session-queries.ts
      model/session-policy.ts
      ui/login-form.tsx
    tasks/
      api/task-queries.ts
      api/task-commands.ts
      model/task-search.ts
      ui/task-list-page.tsx
      ui/task-details-page.tsx
      ui/task-create-dialog.tsx
      ui/task-rename-form.tsx
      ui/task-history.tsx
      ui/task-filters.tsx
      ui/task-presenters.tsx
      ui/tasks.css
    operations/
      api/exchange-queries.ts
      api/exchange-commands.ts
      model/decision.ts
      ui/issue-list-page.tsx
      ui/issue-details-page.tsx
      ui/decision-form.tsx
      ui/reconciliation-page.tsx
      ui/reconcile-button.tsx
      ui/exchange-snapshot.tsx
      ui/operations.css
  shared/
    api/http.ts
    lib/collections/
    lib/pagination/
    lib/router/
    ui/
    styles/
build/generated/openapi/        # результат Orval, не ручной код
```

Transport не обязан получать по классу и интерфейсу. Generated функции уже
тонкие; предметные queryOptions/команды добавляют cache/error/command семантику,
а не пересылают вызов ради дополнительного файла.

### Контракты зависимостей

1. app собирает providers, маршруты, оболочку и feature-страницы.
2. shared не импортирует app или features, не знает business route IDs,
   allowedActions и жизненный цикл пользовательской сессии.
3. Feature не импортирует composition root. Доступ к QueryClient получает
   штатным useQueryClient/явным параметром; глобальная копия состояния не вводится.
4. Ключи чтений и queryFn принадлежат одному предметному API-модулю.
   Prefetch и экран используют одни options, включая AbortSignal.
5. Реальный межсценарный вызов допускается через узкий публичный вход.
   Нынешний TaskCard → ReconcileButton — предметно обоснованная связь,
   а не повод переносить операторскую команду в business-free shared/ui.
6. Состав публичного входа определяет feature; не нужен общий barrel,
   переэкспортирующий всё дерево и скрывающий циклы. Проверяется файловый граф
   и разрешённые связи, не только наличие index.ts.
7. Pure UI принимает данные/действия, а model/command владеет их смыслом.
   Это не запрет на Hooks в UI и не требование dumb-компонента на каждую строку.

### Владельцы состояния

| Состояние | Единственный владелец | Условие сброса |
| --- | --- | --- |
| Task, issue, history, reconciliation | React Query, ключ с ID и параметрами | Инвалидация, gcTime, выход/смена пользователя |
| Сессия | auth policy + session query | Серверный logout, 401, смена identity |
| Фильтры и desktop page/size | URL и предметный parser | Явный reset/изменение условий |
| Загруженные страницы мобильной ленты | Infinite query | Смена query key; бюджет требует отдельного решения |
| Черновик и expected revision | Активная форма конкретного ID | Смена record ID, подтверждённое завершение или явный discard |
| Pending / accepted / ошибка обновления | Сценарий команды | По результату своей фазы, не по общему «любой запрос упал» |
| Модалка, disclosure, editing | Ближайший устойчивый UI-владелец | Закрытие или смена предметной identity |
| Цветовая тема | Один владелец preference | Явное изменение; storage синхронизирует вкладки |
| Idempotency key | Одна отправляемая команда и её неизменное тело | Подтверждённое завершение либо новый осознанный input |
| Права и допустимые действия | Backend; UI лишь отображает контракт | Новый серверный снимок |

useState(task.titleRevision) внутри одного сеанса редактирования не нужно
заменять слепым чтением последнего prop. Важно зафиксировать версию правильно
выбранной записи и не прятать конкурентное изменение сервера.

## Что уже сделано правильно

- Записи не копируются из Query в useState; derived collections считаются
  при чтении, URL-фильтры не дублируются отдельным глобальным store.
- QueryClient создан устойчиво вне render. Выход и смена пользователя отменяют
  и удаляют приватные queries и mutation cache. Сохранять эту границу обязательно.
- Generated DTO и реальные AbortSignal проходят до HTTP; новые DTO-копии
  или второй fetch-клиент каждому экрану не нужны.
- Команды выполняются из событий/mutations, не из Effects; автоматический
  retry мутаций отключён, безопасный повтор имеет idempotency key.
- allowedActions приходит с сервера. Проверки роли в навигации не заменяют
  backend-права, и backend действительно проверяет их в сервисах.
- useMediaQuery использует useSyncExternalStore. DOM measurement и observers
  имеют cleanup; это оправданные внешние интеграции React.
- Dialog использует Radix для focus trap/portal/dismiss; обычные ссылки
  сохраняют браузерную навигацию и клавиатуру.
- Сложность ChoiceFormBridge объясняется native FormData/required/reset/fieldset
  и Tab, покрыта компонентными сценариями. Удалять этот код только ради уменьшения
  количества строк нельзя. Сохраняются лицензия и происхождение Base.
- Типизация, реальный API в E2E и отдельные component fixtures уже дают хорошую
  базу для безопасного рефакторинга. Недостаёт конкретных edge-case и boundary gates.

## Порядок доработки и критерии приёмки

Это рекомендуемый порядок отдельных логических изменений. Исполнение этим
отчётом не начато; массовое перемещение файлов до исправления поведения не нужно.

| Этап | Объём | Проверяемое завершение |
| --- | --- | --- |
| 1. Корректность | FA-01–FA-04: identity формы, render fallback, outcome команды и transport errors. | Cached A/B и refetch того же ID; отсутствие повторной записи после подтверждения; HTML/JSON/empty/abort; fallback и восстановление. |
| 2. Владелец сценария | FA-05 и FA-08: auth/API/query contracts, самостоятельные формы/история/фильтры, общая dirty/pending политика. | Один query owner на чтение, все вызовы переведены, прежний путь удалён; session isolation, pending/discard и command replay сохранены. |
| 3. Composition и guardrails | FA-06/FA-07/FA-11: route objects, import gates, Hooks lint, StrictMode, co-located layout. | Текущие URL/роли/modal route/Back/Forward/focus сохранены; отрицательный import fixture отклоняется; cleanup выдерживает StrictMode. |
| 4. Бюджет роста | FA-09/FA-10: длинная история, refetch/DOM budget, явная query projection. | Измерены число запросов/страниц/DOM, определён предел и способ доступа к старым событиям; отмена чтений и возврат в ленту работают. |

Для каждого среза сначала нужны быстрые проверки затронутого сценария. На общей
интегрированной точке — build, typecheck, unit/assets, component fixtures и полный
UI-набор на desktop/mobile через штатный host slot. Новые проверки добавляются
по причине риска, не как копии внутренней реализации.

Регрессии, которых особенно не хватает сейчас:

- Тёплый кэш двух detail ID при открытой форме и соседний refetch того же ID.
- Подтверждённая mutation с отказом последующего GET/invalidation.
- HTTP status при не-JSON ошибке, пустом успехе и отменённом запросе.
- Контролируемое исключение React и route/chunk recovery.
- Decision/Rename dirty/pending, явный discard и сохранение фокуса.
- Длинная история: стоимость polling после нескольких загруженных страниц.
- Реальные запрещённые import edges и повторный setup/cleanup в StrictMode.

## Решения, которые сейчас не обоснованы

Нет оснований вводить Redux/Zustand поверх Query, переписывать всё на Next.js,
добавлять frontend repositories/DI containers, переносить server business rules
в TS или создавать заранее все слои большой frontend-методологии.
Не нужно также заменять понятные native формы на новую form/schema библиотеку
без конкретного требования, повсеместно ставить memo/useMemo или внедрять React
Compiler как условие существования корректной архитектуры.

Твёрдый фундамент здесь определяется владельцами, identity, наблюдаемыми ошибками
и проверяемыми контрактами. Новые каталоги полезны в той мере, в какой закрепляют
эти правила и позволяют найти сценарий без чтения всего приложения.
