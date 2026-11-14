# План доработки архитектуры frontend

Статус: **реализация начата, итоговая квалификация не выполнена**.
Основание — [архитектурный аудит от 14 ноября 2026](frontend-architecture-audit-2026-11-14.md).
Исходная ревизия — main `6c335b65c82e35d5bfc95cb5c4d07ac4895618f8`.
Перед выполнением повторно сверить HEAD, инструкции и изменения после этой ревизии.

Текущая ветка: `feat/frontend-foundation`. Промежуточные результаты:

- FR-00: каталоги component/E2E разделены; discovery сохранил 74 и 10 исходных
  проверок. Совместимость lint подтверждена тремя положительными/отрицательными
  probe tests, peer conflicts отсутствуют.
- FR-01: ошибка сначала воспроизведена постоянным тестом на исходном коде;
  граница по taskId исправлена. Восемь новых component checks прошли в двух профилях.
- FR-02: Orval использует один mutator; старые HTTP/CSRF определения удалены,
  потребители переведены. Typecheck и 32 проверки клиента/транспорта прошли.
  Проверка политики 401 и всех пользовательских сценариев остаётся в итоговом gate.
- FR-03: у записи и последующей актуализации отдельные observable операции;
  16 component checks подтвердили create/rename/reconcile/take/decision,
  повтор неизвестного исхода и login/logout на двух профилях. CSRF получается
  перед каждой следующей командой; лишний post-auth GET убран из её подтверждения.
- FR-04: корневой fallback подключён; regression fixture проверяет обычные
  ошибки и отказ lazy-компонента — 10 component checks прошли.
  Интеграция вложенной границы ожидает FR-09.
- FR-05: один общий navigation guard применён к трём формам; проверены local
  cancel, route departure/discard, focus, pending, reload и same-ID параметры.
  Расширенные task/command specs: 32 проверки прошли вместе, две проверки
  native reload прошли отдельным повтором после исправления ожидания в runner.
  Полная интеграция с новым router и правилами operator capabilities ещё впереди.
- FR-06: общие UI/стили/helpers перенесены в shared, auth policy и команды —
  в features/auth; QueryClient создаётся providers, без глобального экземпляра.
  Предметные key factories выделены раньше FR-07/FR-08, app/api.ts удалён.
  Typecheck, scoped lint и 34 component checks прошли после переноса.
- FA-10: generic collection page и memo projection отделены от query proxy
  уже при переносе в shared; все три потребителя обновлены. Проверка pure projection
  проходит. Ограничение окна, нагрузка и интегрированные проверки остаются в FR-11.
- FR-07: tasks разделён на api/model/ui; формы, история, фильтры и представление
  реестра имеют отдельные точки поиска. Query options и инвалидация принадлежат API,
  URL parser и режим списка — model. Все 34 затронутые component checks прошли
  после переноса; scoped lint/typecheck и пять parser/polling tests зелёные.
- CSS перенесён из shell к tasks/operations/auth и общим layout primitives.
  Статическое сравнение PostCSS с предыдущим коммитом подтвердило сохранение
  всех 147 пар selector/media/declarations. Это не заменяет итоговую визуальную проверку.
- FR-06–FR-12: обязательные работы ещё не завершены. Полный build/test gate,
  IAB и публикация итогового кандидата ещё не выполнены.

После fetch origin/main обнаружена новая база `5aa1c06` (девять коммитов после
исходной ревизии): Spring Data read adapters и документация. Изменений frontend
и OpenAPI нет. Эта база включается в task branch перед структурным переносом;
соответствие итогового локального runtime проверяется отдельно в FR-12.

Выбор lint: Babel парсит TSX без compiler API TypeScript, а существующий tsc
проверяет типы на 7.0.2. React/Query/import правила остаются стандартными plugins.
typescript-eslint utilities этих plugins пока требуют API TS 6: их собственная
зависимость закреплена на 6.0.2 через pnpm; версия компилятора приложения не меняется.
Настройку пересмотреть при обновлении utilities до версии с поддержкой API TS 7.
Основания: [Babel parser](https://babeljs.io/docs/babel-eslint-parser/),
[поддерживаемые версии typescript-eslint](https://typescript-eslint.io/users/dependency-versions/),
[pnpm: scoped dependency/peer overrides](https://pnpm.io/settings).

Уточнение lazy-механизма: в установленном Router 7.18.5 отказ функции route.lazy
без loader оставил пустой Outlet в component reproducer. Его реализация
callDataStrategyImpl подавляет rejection оставшихся lazy promises после стратегии.
Для экранов с Query-owned чтениями выбран React.lazy + Suspense внутри единого
дерева Route Objects со статической route error boundary. Искусственные loaders,
второй кэш или запасная lazy-реализация не добавляются. Проверка rejected chunk
остаётся обязательной; обычный успешный split подтверждается в FR-09/FR-12.

## 1. Результат и обязательный объём

Цель — понятная структура React-приложения с явными владельцами состояния,
API, команд, маршрутов и UI, проверяемыми границами и устойчивым поведением
при смене записи, ошибках сети и росте истории.

План закрывает все FA-01–FA-11. Исправления поведения выполняются раньше
широкого переноса файлов. Перенос считается завершённым только после перевода
всех потребителей и удаления заменённых определений; совместимые реэкспорты
из старых каталогов и параллельные реализации не остаются.

Обязательный результат:

- Черновик и expected revision принадлежат конкретной записи и сеансу формы.
- Подтверждение команды отделено от последующего обновления чтений.
- HTTP status, нарушение контракта и отмена запроса имеют разную семантику.
- Исключение React показывает контролируемый экран восстановления.
- Dirty/pending формы защищены согласованно.
- Есть одна конфигурация маршрутов и один QueryClient.
- app собирает приложение, features владеют сценариями, shared — общими механизмами.
- React-правила и разрешённые импорты проверяются автоматически.
- Мобильные ленты имеют ограниченный бюджет памяти, DOM и перечитывания,
  сохраняя доступ к старым записям и возврат к месту чтения.
- Сохранены текущие функции, роли, URL, клавиатурная навигация и мобильное поведение.

Текущий результат — план работ. Изменение кода, публикация PR,
слияние и deployment относятся к исполнению соответствующего поручения.
При поручении на реализацию обычные технические шаги выполняются автономно в его рамках.

## 2. Ограничения и сохраняемые контракты

| Область | Обязательный контракт |
| --- | --- |
| Рабочая среда | Локальный Windows workspace; preview `http://127.0.0.1:19673`, существующий system-integration-load и loopback API/эмулятор/БД. |
| Данные | Существующие записи, тома, credentials и соседние приложения сохраняются. Проверки создают собственные fixtures; очистка только по их точным ID. |
| Server state | React Query остаётся единственным владельцем серверных записей и загруженных страниц. |
| Права | Backend проверяет доступ и определяет allowedActions; frontend отображает полученный контракт. |
| Формы | Черновики локальны; idempotency key относится к одной команде и её неизменному input. |
| Desktop | Размер страницы зависит от доступной высоты; footer остаётся внизу, фильтры и текущая страница отражаются в URL. |
| Mobile | До 760 px — карточки и автоподгрузка по 20 записей, одна прокрутка документа, без номерной пагинации. |
| Навигация | Сохраняются прямые ссылки, модальное `/tasks/new`, Back/Forward, фильтры, native Ctrl/middle-click и восстановление фокуса. |
| API | Внутренний OpenAPI — источник DTO. Generated output остаётся в build/generated, ручных правок generated-файлов нет. |
| UI | Сохраняются Base/Radix, лицензии, native FormData/required/reset/fieldset и существующие палитры. |
| Ресурсы | Один тяжёлый прогон через общий host execution slot. Чужие процессы не останавливаются ради допуска. |

Backend-миграции, новые бизнес-правила, публичный deploy и смена стека
не требуются для основного объёма. Возможная cursor-пагинация выделена
в раздел дополнительных решений, а не скрыта внутри frontend-рефакторинга.

## 3. Выбранная архитектура

### 3.1. Направление зависимостей

**app → features → shared**.

- app: providers, router, auth/role layouts, оболочка и корневой fallback.
- Feature: предметные query options/keys, команды, формы, parser и отображение.
- shared: transport, общий query/DOM/router механизм, primitives и tokens.
- Данные сессии не копируются во второй store или Context state.
- Реальное межсценарное использование имеет узкий публичный вход и проверяемый граф.

Выбор сохраняет текущие React, Router, Query, Orval и CSS. Глобальные
components/hooks/services/types разнесли бы один сценарий по всему дереву.
Полная многоуровневая схема с entities/widgets/DI сейчас не оправдана масштабом.
Название каталога не заменяет владельца поведения; маленькие связанные части
можно хранить в одном файле.

### 3.2. Целевая карта файлов

Ниже — целевые точки поиска, создаваемые при появлении их потребителя.
Пустые каталоги и однотипные обёртки ради структуры не создаются.

```text
frontend/src/
  main.tsx
  app/
    app.tsx
    router.tsx
    providers.tsx
    root-error-boundary.tsx
    route-error-boundary.tsx
    shell/
      app-shell.tsx
      app-header.tsx
      mobile-account-menu.tsx
      brand.tsx
      theme.tsx
      shell.css
  features/
    auth/
      api/session-queries.ts
      api/session-commands.ts
      model/session-policy.ts
      ui/login-form.tsx
    tasks/
      api/task-keys.ts
      api/task-queries.ts
      api/task-commands.ts
      model/task-search.ts
      model/use-task-list.ts
      ui/task-list-page.tsx
      ui/task-details-page.tsx
      ui/task-create-dialog.tsx
      ui/task-rename-form.tsx
      ui/task-history.tsx
      ui/task-filters.tsx
      ui/task-presenters.tsx
      ui/tasks.css
    operations/
      api/exchange-keys.ts
      api/exchange-queries.ts
      api/exchange-commands.ts
      api/invalidate-exchange.ts
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
    api/csrf.ts
    lib/collections/
    lib/pagination/
    lib/router/
    lib/forms/
    ui/
    styles/
```

HTTP/data/ApiError переезжают из app/api.ts, а session policy и предметные keys
получают собственных владельцев. `shared/api/http.ts` не импортирует React,
сессию или feature. Доступ к QueryClient передаётся штатным useQueryClient
либо явным параметром; app/providers.tsx создаёт один экземпляр и связывает
общий обработчик 401 с auth policy.

Разрешённые межсценарные связи:

- Task details использует операторскую кнопку сверки через объявленный вход
  operations/reconciliation; это предметная команда, её не переносим в shared/ui.
- Инвалидация обмена использует публичные task keys, не task UI или app/api.
- Модуль task keys не импортирует operations. Общего barrel, переэкспортирующего
  одновременно все UI и query-модули feature, не требуется.
- Общие для задания и операторского снимка подписи статусов имеют владельца
  tasks/model/task-labels.ts; этот чистый модуль — объявленный публичный вход
  для presentation операций. Форматирование времени остаётся в shared.
- Остальные глубокие импорты чужих внутренних файлов запрещаются правилами.

### 3.3. Технические решения

| Вопрос | Решение |
| --- | --- |
| HTTP | Один mutator/custom client Orval, сохраняющий status/headers и текущий типизированный вызов generated функций. Совместимость проверяется на Orval 8.47.0 до изменения всех вызовов. |
| Query | Предметные queryOptions/infiniteQueryOptions; ключ и queryFn одного чтения находятся вместе. |
| Команды | Предметные hooks/функции с явным разделением отправки, подтверждения и ошибки актуализации. Без общего CRUD command framework. |
| Формы | Текущие native поля и Radix; небольшой общий navigation guard для реальных dirty/pending форм. |
| Router | Route Objects имеющегося Data Router; loaders не создают второй кэш данных. |
| UI | Общие primitives принимают данные/действия; бизнес-сообщения и команды принадлежат feature. |
| Тесты | Существующие Node unit и Vite + Playwright component fixtures; новый test framework только при доказанном пробеле. |
| Качество | Совместимый ESLint toolchain, React Hooks/Query rules и import/cycle rules; StrictMode в dev/test. |
| Ленты | По умолчанию проектируется окно до пяти страниц по 20 записей с доступом в обе стороны. Сохранение позиции — обязательная часть, а не последующий косметический fix. |

## 4. Последовательность и зависимости

Одна рабочая ветка, логические коммиты по завершённым срезам, один владелец
изменений и runtime. Точки ниже не требуют запуска полного gate после каждого
среза: во время разработки выполняются быстрые проверки затронутых границ.

| Этап | Содержание | Зависит от | Основные FA |
| --- | --- | --- | --- |
| FR-00 | База, тестовые границы и проверка совместимости инструментов | — | Все |
| FR-01 | Идентичность detail-формы | FR-00 | FA-01 |
| FR-02 | HTTP/error boundary и generated client | FR-00 | FA-04 |
| FR-03 | Подтверждение команды и актуализация чтений | FR-01, FR-02 | FA-03 |
| FR-04 | Контролируемые ошибки рендера | FR-02 | FA-02 |
| FR-05 | Общая политика dirty/pending форм | FR-01, FR-03, FR-04 | FA-08 |
| FR-06 | Общий слой, providers и auth | FR-02, FR-03, FR-05 | FA-05 |
| FR-07 | API/model/UI заданий | FR-06 | FA-05, FA-11 |
| FR-08 | API/model/UI разборов и сверок | FR-06, FR-07 | FA-05, FA-11 |
| FR-09 | Единое дерево маршрутов и lazy-границы | FR-04, FR-05, FR-07, FR-08 | FA-06 |
| FR-10 | React/import guardrails и StrictMode | Совместимость FR-00; окончательные границы FR-09 | FA-07 |
| FR-11 | Query projection и бюджет длинных лент | FR-07–FR-10 | FA-09, FA-10 |
| FR-12 | Интегрированная квалификация и документация | Все предыдущие | Все |

### FR-00. Зафиксировать базу и подготовить проверяемые границы

**Работа:**

- Сверить текущий Git, [AGENTS.md](../AGENTS.md),
  [frontend/AGENTS.md](../frontend/AGENTS.md) и [tests/AGENTS.md](../tests/AGENTS.md).
  Сохранить несвязанные изменения и существующий локальный стенд.
- Подтвердить версии React/Router/Query/TypeScript/Orval из установленных пакетов
  и lockfile. Проверить выбранный ESLint/parser/plugins на TypeScript 7,
  Node 26, TSX и type-only imports, затем зафиксировать совместимые версии.
- Разнести component specs и прикладные E2E по каталогам: существующие
  choice-fields.spec.ts и pagination-navigation.spec.ts перевести из tests/e2e
  в tests/components, поправив относительный импорт support.
- Настроить components.config.ts на этот каталог, основной runner — на e2e.
  Убрать дублирующиеся списки component-файлов из testIgnore/testMatch.
  Сами HTML/TSX fixtures пока остаются в frontend/tests.
- Воспроизведения аудита превратить в настоящие regression tests в следующих
  этапах. Ignored probes не считать постоянным gate.

**Файлы:** tests/components.config.ts, tests/playwright.config.ts,
tests/components/, tests/README.md; совместимость — frontend/package.json/lockfile
и будущая frontend/eslint.config.js.

**Завершение:** сбор тестов видит все исходные 74 прикладных и 10 компонентных
проверок в своих runner, без двойного запуска и исчезнувших сценариев.
Определён работающий lint toolchain. Полный прогон для перестановки test paths
не нужен: достаточно discovery и затронутых компонентных сценариев.

### FR-01. Привязать форму к identity задания

**Причина:** при прямой смене :id в том же React-дереве тёплый Query cache
не вызывает Loading/unmount. editing, defaultValue и frozen revision прежней
формы продолжают жить с taskId другой записи.

**Работа:**

- В task-details.tsx выделить предметную границу detail-экрана с key по taskId.
  Смена ID сбрасывает editing, черновик, expected revision и command ref.
- Не использовать key по titleRevision, статусу или результату polling.
- Внутри одной формы сохранить expected revision, с которой началось редактирование.
  Новая версия той же записи должна давать корректный конфликт, а не молча
  заменять expected revision или стирать введённый текст.
- Добавить постоянную fixture реального detail-компонента и QueryClient
  в frontend/tests и regression spec в tests/components.

**Файлы:** frontend/src/features/tasks/task-details.tsx;
новые frontend/tests/task-identity.{html,tsx}, tests/components/task-identity.spec.ts.

**Проверки:** A → B с тёплым/холодным кэшем, равными/разными revision; history jump;
refetch A во время ввода; явная отмена и повторное открытие формы.

**Завершение:** ни черновик, ни версия A не могут попасть в команду для B.
Повторное чтение A не меняет пользовательский черновик. После FR-05 переход
с dirty-формой дополнительно требует явного discard; этот тест обновляется
на новый пользовательский контракт, а проверка identity сохраняется.

### FR-02. Сделать одну строгую HTTP-границу

**Причина:** generated JSON.parse выполняется до возврата status. HTML 401/502
становится SyntaxError; пустой 200 получает фиктивный data={}.

**Работа:**

- В shared/api/http.ts определить транспорт, нормализацию ошибок и data unwrap.
  Различать network error, HTTP error с настоящим status и protocol/decode error.
  AbortError не превращать в пользовательскую HTTP-ошибку.
- Настроить один поддерживаемый mutator через frontend/orval.config.ts.
  На пробной генерации проверить сохранение command headers, signal, сериализации
  фильтров, form login и текущих типов ответов. Не редактировать generated output.
- Статус сохраняется даже при HTML/пустом/невалидном теле ошибки. На экран
  не попадают raw HTML, технический stack, headers или секреты.
- Для объявленных успешных JSON-ответов требовать тело и корректный JSON.
  204 обрабатывать как отсутствие тела согласно OpenAPI. Не подставлять
  пустой объект/массив вместо нарушения контракта.
- CSRF helper выделить в shared/api/csrf.ts. Каждый реальный потребитель переводится
  на новый import в том же коммите; старые data/ApiError/csrf определения удаляются
  из app/api.ts. Пока не перенесённые session/keys остаются там до FR-06–FR-08.
- Полную runtime schema generation не добавлять автоматически. Если проба выявит
  необходимость проверки структуры DTO сверх тела/JSON, описать её границу
  по OpenAPI и использовать генерацию, а не ручную копию всей схемы.

**Файлы:** frontend/orval.config.ts, новые shared/api/http.ts и csrf.ts,
app/api.ts, app/error-message.tsx и все generated-client consumers;
frontend/tests/api-client.test.mjs и новые HTTP boundary tests.

**Проверки:** JSON 401/403/409/503, HTML 401/502, пустой и битый JSON успеха,
валидные 200/201/204, отмена, нужные command headers и неизменённый body.

**Завершение:** HTTP status доступен прикладной политике независимо от формата
ошибки; 401 способен завершить сессию; unsupported success не считается данными.
Один транспорт обслуживает все endpoints, без цепочки запасных клиентов.

### FR-03. Разделить outcome команды и ошибку актуализации

**Причина:** успешный mutationFn и упавший onSuccess/refetch сейчас дают общее
mutation error. Кроме того, Login/Logout ожидают GET CSRF после подтверждённого
204; сбой этого GET может задержать обновление или очистку локальной сессии.

**Работа:**

- Для create, rename, reconcile, take и decision явно разделить отправку,
  подтверждённый результат и последующую актуализацию данных.
- После подтверждения сохранить receipt/result и не предлагать повтор POST/PATCH
  как способ исправить ошибку GET. Показывать отдельный retry чтения.
- Для неизвестного исхода записи сохранить input и idempotency key; повтор
  использует прежний ключ. Изменение input является новой осознанной командой.
- Не лечить проблему удалением await с подавлением ошибок или fire-and-forget.
  Ошибка обновления остаётся видимой и управляемой.
- Проверить auth: подтверждённый logout очищает приватный cache независимо от
  последующего CSRF/session чтения. Подтверждённый login ведёт к проверке сессии;
  сетевой сбой этой проверки не изображается неверным паролем.
- Сохранить получение корректного CSRF для следующей команды по существующему
  контракту SecurityConfiguration; auth endpoints не получают выдуманный
  idempotency header, которого нет в их OpenAPI.
- Вначале исправить текущие владельцы; при FR-06–FR-08 перенести их в предметные
  command-модули без изменения согласованного поведения.

**Файлы:** app/App.tsx, task-create.tsx, task-details.tsx,
operations/issue-details.tsx, reconcile-button.tsx, use-refresh-exchange.ts;
новые command-outcome component fixtures/specs и затронутые E2E.

**Проверки:** подтверждение команды → 502 GET; потеря ответа после записи → replay;
новый input; logout 204 → ошибка следующего GET; login 204 → ошибка session GET.

**Завершение:** подтверждённая запись не становится «не выполнена» из-за чтения;
retry актуализации не делает повторной записи, а неизвестный исход остаётся
неизвестным до безопасного повтора. Приватные данные не остаются после logout.

### FR-04. Ввести контролируемое восстановление после React-ошибок

**Работа:**

- Добавить root-error-boundary.tsx к текущему Data Router, до крупной смены routing.
  Fallback не зависит от успешной сессии или запроса.
- Показать понятное сообщение и явные действия восстановления/навигации.
  Не делать автоматический бесконечный reload/retry.
- Запланировать вложенный route-error-boundary для области экрана; окончательно
  подключить его в едином дереве FR-09, сохранив оболочку при сбое страницы.
- API validation/not-found/conflict и ошибки событий остаются предметными
  состояниями, а не переводятся все в render fallback.
- Для диагностики использовать минимальные обезличенные сведения об ошибке.
  Новый telemetry-сервис не вводится; тела запросов, cookies и credentials не логируются.

**Файлы:** frontend/src/main.tsx, новые app/root-error-boundary.tsx
и route-error-boundary.tsx; error-boundary fixture/spec в существующем component runner.

**Проверки:** исключение дочернего компонента, произвольное thrown value,
восстановление/переход на рабочую страницу; после FR-09 — отказ lazy chunk.

**Завершение:** нет стандартного Unexpected Application Error/raw stack на экране;
пользователь имеет рабочий выход. Ошибка не маскируется пустым списком.

### FR-05. Согласовать dirty/pending/accepted формы

**Работа:**

- Выделить общий небольшой guard поверх useBlocker/useBeforeUnload и DiscardDialog.
  Dirty input остаётся локальным состоянием формы.
- Применить его к NewTask, RenameForm и DecisionForm.
- Зафиксировать поведение: уход со страницы или смена record ID при dirty
  требуют явного discard; pending блокирует редактирование, повтор и обычный
  уход; accepted outcome использует правила FR-03, не отменяет серверный результат.
- Изменение параметров истории того же задания и служебная синхронизация
  page/size не считаются уходом из предметной формы.
- Оставить одного активного владельца Router blocker. Не добавлять ручные
  перехватчики history или конкурирующие глобальные обработчики.
- После отмены discard возвращать фокус к форме; после закрытия — к trigger.

**Файлы:** shared/lib/forms/use-form-navigation-guard.ts,
три текущие формы, текущий ui/dialog.tsx, task-modal/operations E2E
и новые form-navigation component tests. Перенос dialog.tsx в shared/ui
выполняется в FR-06 вместе с остальными общими компонентами.

**Проверки:** ссылка, Back/Forward/history jump, reload, same-ID query change,
pending, failed/unknown command, accepted + refresh error, продолжение ввода,
явный discard и фокус. Учитывать разные taskId/issueId.

**Завершение:** нет неявной потери решения оператора и редактирования поверх
незавершённой отправки; modal create сохраняет прежнюю защиту.

### FR-06. Разделить shared, providers, auth и shell

**Работа:**

- Перенести общие primitives, DOM hooks и tokens из src/ui в shared с сохранением
  Base attribution/LICENSE/NOTICE. Обновить все source и fixture imports.
- Общие collection/pagination/router механизмы вынести из app в shared/lib.
  Они не знают task/issue endpoints и прав пользователя.
- Устранить shared UI → app зависимость FeedFooter/ErrorMessage. Общий presenter
  получает сообщение/состояние либо общий API error, но не импортирует composition root.
- Создать app/providers.tsx с одним QueryClient. Auth policy принимает его явно,
  features используют штатный useQueryClient, не импортируют app singleton.
- Из app/api.ts перенести session query/commands/clear policy в features/auth.
  При смене userId/role сначала отменить и удалить прежние приватные queries/mutations,
  затем публиковать новую identity. Подписка на session query сохраняется.
- Login выделить в auth/ui; shell/header/mobile menu/brand/theme — в app/shell.
  Тема имеет одного владельца; storage синхронизирует вкладки, а не бизнес-данные.
- Сохранить существующие query defaults и интервалы, пока их не меняет FR-11.

**Файлы:** текущие app/App.tsx, api.ts, theme.tsx, Brand.tsx,
error-message.tsx, use-*; src/ui; новые app/providers.tsx,
app/shell, features/auth, shared; frontend/tests imports.

**Завершение:** shared не зависит от app/features. Auth, HTTP и composition
имеют отдельных владельцев. В app/api.ts временно остаются только ещё не
перенесённые предметные keys; их конечное удаление — FR-08.

**Проверки:** cold login, неверные credentials, 401, logout, смена пользователя
в другой вкладке/вне SPA, повторный вход тем же пользователем, offline/online,
палитры и недоступный storage. Нельзя показать прежнюю private card новой identity.

### FR-07. Выделить владельцев сценариев заданий

**Работа:**

- В tasks/api создать keys, detail/list/history query options и команды.
  Экран и prefetch используют один key/queryFn, signal и freshness contract.
- В model/task-search.ts вынести чистый разбор фильтров. Значения статусов
  проверяются по контракту, а не по произвольному объекту UI labels.
- Для дат согласовать UTC-формат, включённую нижнюю/исключённую верхнюю границы
  и проверку периода с внутренним API. Неверный URL не отправляет неверный запрос.
- Общий parser page/size имеет одного владельца в shared pagination/router;
  task parser использует его, не дублирует числа и ограничения.
- Сохранить проверку actual pathname/search/hash перед записью измеренного size.
  Старый layout effect не отменяет новый маршрут или фильтр.
- Page связывает URL/model/query и actions; формы, фильтры, history и два
  представления записей получают самостоятельные компоненты по поведению.
  Не создавать универсальный table/list framework для двух реестров.
- Task layout CSS перенести из app/styles.css к tasks. Shared primitive-варианты
  и форматирование сохраняют общего владельца.

**Файлы:** features/tasks/*, app/format.ts, app/api.ts, app/styles.css,
новые tasks/api, model и ui по целевой карте; tests/task-search unit,
tasks/pagination/adaptive-pagination/task-modal E2E и identity fixture imports.

**Завершение:** сценарий задания находится внутри tasks; компонент строки/формы
не выбирает cache policy и endpoint. Нет копий Query data в useState,
повторных parser и старого Tasks.tsx/alias-пути.

### FR-08. Выделить владельцев разборов и сверок

**Работа:**

- В operations/api определить issue/reconciliation queries, keys и команды
  take/retry/resolve/reconcile, сохранив outcome FR-03.
- Явно описать инвалидацию связанных task/issue чтений. Инвалидировать нужные
  префиксы, не очищать весь QueryClient после каждой команды.
- Отдельные DecisionForm и Snapshot представляют данные; серверные allowedActions,
  issueRevision и reconciliationId определяют допустимый input.
- Сохранить различие task issue и общей проблемы ленты без taskId.
  Не добавлять клиентские бизнес-переходы вместо backend policy.
- Сделать узкие публичные входы для кнопки сверки и task keys; остальные внутренние
  imports между features не разрешать автоматически.
- Перенести operations CSS и presentation labels к владельцу. Удалить опустевший
  app/api.ts и заменённые app helpers после перевода всех потребителей.

**Файлы:** features/operations/*, features/tasks detail integration,
остатки app/api.ts/format.ts/styles.css; operations/refresh/spacing E2E
и command/form component tests.

**Проверки:** оператор и оба инициатора; task issue и общая issue;
take/передача владения; устаревшие revisions/сверка; потерянный ответ, повтор,
ошибка актуализации, dirty/pending решение, неизменяемая сохранённая сверка.

**Завершение:** нет API/command логики операторских сценариев в app/shared UI,
нет заменённых определений keys; server capabilities и private cache сохранены.

### FR-09. Собрать единое дерево маршрутов

**Работа:**

- В app/router.tsx перенести реальные route objects из descendant Routes.
  Удалить старое параллельное описание URL в Shell.
- Разделить root/session/auth/role layouts. Query-backed auth gate передаёт
  readonly session data в экран; новой копии сессии не создаётся.
- Сохранить список URL, /tasks/new как modal child, typed Outlet context
  для returnFocusRef, unknown route и прямые ссылки.
- Подключить nested error boundary области экрана под устойчивой оболочкой.
- Страницы, особенно операторские, загружать через React.lazy + Suspense
  в Route Objects (обоснование выбора выше). Отказ chunk
  получает контролируемый fallback FR-04, а не бесконечный reload.
- Не добавлять второй слой fetching в loaders. Нужный prefetch использует
  те же feature options и QueryClient.
- Сохранить returnTo с проверкой собственного реестра, ScrollRestoration
  и reset identity по ID. Не сохранять бизнес-DTO в history state.

**Файлы:** app/router.tsx, app/app.tsx, app/providers.tsx, app/shell,
main.tsx, route error boundaries и typed route contexts;
navigation/task-modal/table-navigation/session E2E.

**Завершение:** адрес/роль/страница находятся в одном route конфиге. Все прежние
deep links и Back/Forward работают; Shell переживает сбой отдельной страницы.
Build показывает отдельные lazy chunks, а asset tests подтверждают корректные
сжатые файлы и отсутствие test fixtures в production payload.

### FR-10. Защитить React и структуру автоматическими правилами

**Работа:**

- Ввести frontend/eslint.config.js и scripts lint/typecheck с совместимыми
  зафиксированными версиями из FR-00. Не скрывать нарушения общими disable.
- Проверять Rules of Hooks, dependency arrays, mutation/purity/ref правила,
  применимые Query rules и запрещённые imports.
- Настроить цикл-проверку подходящим правилом линтера с корректным TS resolution.
  Выбор plugin/resolver фиксируется после проверки TypeScript 7 в FR-00;
  лексический regex inventory аудита не является постоянным architecture gate.
- Shared → app/features запрещён; feature → app запрещён; межсценарные
  исключения имеют конкретные публичные пути. Generated imports разрешены
  владельцам API и оправданным type-only потребителям.
- Проверить отрицательные и положительные lint fixtures: нарушение действительно
  отклоняется, корректный соседний import/type-only import проходит.
- Включить StrictMode в development и component fixtures. Проверить cleanup
  observers, storage/media listeners, timers, refs и поведение блокировок.
- При повторном dev setup не допустить повторной бизнес-команды. Проверки
  отменённых/повторённых GET учитывают штатный StrictMode lifecycle.

**Файлы:** frontend/package.json/pnpm-lock.yaml/eslint.config.js,
main.tsx, frontend/tests fixtures, tests/components и конфигурации;
AGENTS.md/README после стабилизации правил.

**Завершение:** lint/typecheck зелёные; намеренное нарушение ловится;
StrictMode не создаёт двойных writes, утечек подписок или потерянного фокуса.

### FR-11. Ограничить стоимость коллекций и сделать явную query projection

**Работа с контрактом helper:**

- Убрать зависимость общей коллекции от HistoryPage. Использовать небольшой
  структурный контракт страницы, совместимый с generated ответами трёх коллекций.
- Не разворачивать весь query result. Возвращать query отдельно от items/meta,
  сохраняя штатное отслеживание используемых свойств.
- Проекцию пересчитывать при изменении pages/mode; identifier callback должен
  быть устойчивым и предметным. Не вводить registry selectors или копию данных.
- Сохранить одного владельца query и легальный порядок Hooks при смене mobile/desktop.
  Desktop остаётся одним серверным окном, mobile — последовательностью страниц.

**Работа с бюджетом:**

- На историях/реестрах длиной 20, 100, 1000 и 5000 записей измерить число запросов
  на refetch, число retained pages, DOM items и восстановление позиции.
- Начальное проектное ограничение — до пяти страниц по 20 записей: не более
  100 записей окна и пяти последовательных чтений на его полное обновление.
  Это внутренний проверяемый бюджет, не обещание latency SLA.
- Реализовать ограничение штатным maxPages с корректным getPreviousPageParam
  и доступом к вытесненным записям в обратном направлении. Одностороннее
  обрезание массива с потерей старой истории не закрывает этап.
- Сохранять видимый record ID и смещение при смене окна/возврате из detail.
  Это navigation metadata, не вторая копия server data. Согласовать его
  с ScrollRestoration; одного прежнего scrollY для вытесненного окна недостаточно.
- Auto-load не создаёт конкурирующих запросов и циклов между верхним/нижним
  sentinel; после ошибки ждёт явного retry. Конец ленты не перечитывается
  как следующая страница. Рассмотреть и высокий поддерживаемый viewport.
- Если ID исчез или доступ изменился, показать понятное состояние и доступную
  область списка, сохраняя реальные ошибки чтения. Нельзя подменять ошибку
  фиктивным успехом ради восстановления позиции.
- Зафиксировать семантику текущего offset API при конкурентных вставках:
  дедупликация не обеспечивает snapshot. Стабильный набор без конкурентных
  изменений обходится без пропусков/повторов; строгая live snapshot consistency
  относится к отдельному API-решению.

**Файлы:** shared/lib/collections и pagination/router helpers,
feature collection options, task-history/list/issue-list presenters,
shared/ui/feed-footer, mobile-feed/adaptive-pagination/refresh E2E
и window/scroll component fixtures.

**Критерий проектного решения:** профиль и прототип должны подтвердить бюджет
вместе с доступом ко всем старым записям и сохранением позиции. Если выбранное
штатное окно этого не обеспечивает, до завершения этапа пересмотреть один
дизайн и повторить те же проверки; не оставлять две runtime-реализации,
не считать одно измерение или одно добавление maxPages закрытием FA-09.

**Завершение:** бюджет доказан на длинных данных, прежняя пагинация desktop
сохранена, записи не копируются в state, возврат работает в обе стороны,
ошибки и отмена чтений видны корректно. Виртуализация добавляется только
при измеренной необходимости сверх согласованного окна.

### FR-12. Интегрированная квалификация и передача результата

**Работа:**

- Проверить матрицу FA и весь план по свежим доказательствам финального кода.
  Отдельно осмотреть source ownership, фактические imports и удаление старых путей.
- Обновить architecture.md, frontend/AGENTS.md, frontend/src/shared/ui/README.md,
  tests/README.md, README.md, test-cases.md и current-stage.md.
  В инструкциях оставить действующие правила; отчёты прогонов — в ignored results.
- Сверить актуальную базовую ветку и интегрировать совместимые изменения.
  После последнего изменения кода выполнить один согласованный полный gate.
- Отдельно подтвердить, что отданный локальным Vite код соответствует кандидату,
  и проверить затронутые сценарии через Codex in-app Browser.
- Подготовить одну проверенную ветку/PR с описанием окончательного изменения,
  известными ограничениями offset API и раздельными результатами source/tests/runtime.
  Слияние или deploy требуют соответствующего поручения; план не подменяет его.

**Завершение:** каждый обязательный пункт имеет результат; нет известных
падающих проверок, несогласованных legacy-путей и скрытых незавершённых этапов.
Прошлые результаты не выдаются за квалификацию нового кандидата.

## 5. Матрица закрытия аудита

| Замечание | Этапы | Обязательное доказательство |
| --- | --- | --- |
| FA-01 | FR-01, FR-05 | Тёплые A/B, разные/равные revisions, refetch той же записи, discard и команда правильного ID. |
| FA-02 | FR-04, FR-09 | Исключение/failed chunk, контролируемый fallback и восстановление без потери Shell. |
| FA-03 | FR-03, FR-06–FR-08 | Receipt получен, follow-up GET падает, записи не повторяются; неизвестный outcome использует прежний key. |
| FA-04 | FR-02 | JSON/HTML/empty/abort, настоящий status, отсутствие фиктивного успешного DTO. |
| FA-05 | FR-06–FR-08, FR-10 | Нет нижних зависимостей на app, предметные options/commands имеют владельца; отрицательные import fixtures работают. |
| FA-06 | FR-09 | Один route tree, сохранённые URL/modal/focus/Back/roles, lazy chunks и их recovery. |
| FA-07 | FR-00, FR-10 | Совместимый lint/typecheck, React rules, реальная import/cycle проверка и StrictMode. |
| FA-08 | FR-05 | Create/rename/decision одинаково защищают dirty/pending/accepted; navigation и reload покрыты. |
| FA-09 | FR-11 | Измеренный ограниченный refetch/DOM/cache budget, обратная загрузка старых страниц и стабильный возврат. |
| FA-10 | FR-11 | Общий helper не зависит от HistoryPage и не копирует весь query result; derived items имеют устойчивую проекцию. |
| FA-11 | FR-06–FR-08 | Shell CSS, feature layout и primitives находятся у своих владельцев; палитры и responsive не изменены случайно. |

## 6. Проверки и среда исполнения

### Быстрые проверки во время работы

- Typecheck изменённого frontend, lint затронутых файлов после введения rules.
- Node tests чистого parser/transport/projection там, где модуль исполняется
  штатным runner; React/router/hooks проверяются существующими Vite fixtures.
- Только затронутые component/E2E сценарии, с фиксацией причины каждого нового теста.
- Положительный и отрицательный случаи: разные ID и тот же ID; подтверждённая
  запись и неизвестный исход; валидный API и ошибка; авторизованный и чужой пользователь.

### Финальный полный gate

Команды выполняются последовательно через общий host slot по действующим
инструкциям. Используются проектные Node 26/Corepack и зависимости по lockfile.
Сначала проверяются занятые builders; чужую работу не останавливать.

1. Чистая генерация Orval, lint и TypeScript.
2. Production build и unit tests, затем asset tests на только что собранных файлах.
3. Полный component runner из tests/components.config.ts.
4. Полный прикладной runner из tests/playwright.config.ts на обоих профилях.
5. IAB: native viewport, 320/348/390 px, короткий экран и desktop;
   формы/меню/ошибки, переходы, длинная лента и положение при возврате.
6. Readback source revision/served modules; frontend build и локальный runtime
   фиксируются раздельно. Код API/БД не переобъявляется квалифицированным
   только потому, что прошёл frontend.

Основные существующие команды из корня после подготовки toolchain/environment:

```powershell
Push-Location frontend
corepack pnpm run build
corepack pnpm run test:api
corepack pnpm run test:assets
Pop-Location
node tests/node_modules/@playwright/test/cli.js test -c tests/components.config.ts
$env:SI_UI_FRONTEND_RUNTIME='vite'
node --env-file=.env tests/node_modules/@playwright/test/cli.js test -c tests/playwright.config.ts
```

После FR-10 к gate добавляются новые scripts lint/typecheck. Подробности запуска
окружения остаются в [tests/README.md](../tests/README.md) и
[корневом README](../README.md), а не в ещё одном локальном launcher.
Значения .env не печатаются. UI/recovery/load не направляются на обычные БД.
HTTP smoke, проверяющий gzip/static proxy, применяется к контейнерному frontend;
native Vite не выдаётся за доказательство nginx/gzip-конфигурации.

Исходный ориентир — 74 прикладных, 10 компонентных и 14 unit/asset проверок.
Новые регрессии увеличат число. Удаление/перемещение теста допускается только
при сохранении проверки того же контракта, а не ради зелёного счётчика.

## 7. Совместимость, выпуск и откат

- Public URL, HTTP DTO, способы авторизации, idempotency и версии записей
  сохраняются. В основном объёме нет миграции пользовательских данных.
- Переносы сопровождаются обновлением всех imports, fixtures, docs и build inputs
  в том же срезе. В production payload не попадают test fixtures.
- Смена query key может начать чтение заново в открытой вкладке; кэш не является
  долговечными данными. Перед активацией нового кода учитывать dirty формы
  и не вводить автоматическую перезагрузку с потерей ввода.
- Последовательность логических коммитов позволяет адресный revert проблемного
  среза вместе с его потребителями. Не использовать reset/clean и не откатывать
  БД ради frontend-ошибки.
- Для фактического deploy квалифицировать выбранный build и отданные assets
  на целевом окружении. Слияние исходников, локальный preview и public deploy —
  отдельные результаты; в этом плане public deployment не поручен.
- При отказе допуска к тяжёлому gate продолжать независимые исходные проверки,
  но незапущенный полный gate оставлять незавершённым. Hosted CI, если он появится,
  не считать зелёным без выполнения.

## 8. Решения, требующие проверки при исполнении

| Вопрос | Решение по умолчанию | Что необходимо подтвердить |
| --- | --- | --- |
| TS 7 и lint toolchain | Совместимые закреплённые версии, без обновления runtime стека | FR-00: TSX/type-only imports, React/Query rules, resolver и отрицательные fixtures. |
| Mutator Orval 8.47.0 | Один транспорт с прежними типизированными вызовами | FR-02: generation probe и все формы body/headers/signal/response. |
| Объём mobile window | Пять страниц по 20 записей, обратная загрузка | FR-11: профиль, доступ ко всей истории, scroll anchoring, Back и ошибки. |
| Новая validation/form библиотека | Не добавлять | Требуется конкретный пробел действующих HTML/OpenAPI механизмов и оценка стоимости. |
| Новая тестовая библиотека | Использовать Node + существующие Vite component fixtures | Добавлять только при выявленном неподдерживаемом сценарии; не вводить второй runner без владельца. |
| Cursor/snapshot API | Сохранить существующий offset контракт основного объёма | Если требуется строгий live snapshot, согласовать отдельный API/backend этап до обещания этой гарантии. |

Эти проверки — конкретные инженерные задачи с указанным результатом, не причина
заранее оставлять архитектуру неопределённой. При опровержении выбранного механизма
пересматривается один актуальный дизайн и критерии остаются прежними.
Расширение бизнес-объёма или изменение API оформляется отдельно.

## 9. Дополнительные работы вне обязательного объёма

- Cursor/snapshot-пагинация backend для строгой согласованности при конкурентных
  изменениях; требует отдельного контрактного решения и backend-проверок.
- Дополнительная идентичность задания в issue list и имена авторов вместо UUID
  относятся к API/presentation данным, а не исправляются парсингом текста истории.
- Полная schema validation generated DTO, виртуализация, React Compiler,
  Storybook или новый telemetry-сервис — только после подтверждённой потребности.
- Redux/Zustand, новая frontend domain-копия, repositories/DI framework,
  переход на Next.js и массовая смена CSS-системы этим планом не требуются.

## 10. Итоговый критерий готовности

План выполнен, когда все FR-00–FR-12 и FA-01–FA-11 имеют свежие доказательства,
целевые владельцы находятся по структуре проекта, заменённые пути удалены,
исходные функции сохранены, а финальный кандидат проходит весь согласованный gate.
При наличии незавершённых обязательных пунктов статус остаётся частичным
с точным перечнем; коммит, push или подготовленный PR сами по себе не означают
завершения доработки архитектуры.
