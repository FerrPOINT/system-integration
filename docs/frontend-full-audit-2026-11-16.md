# Всесторонний аудит frontend — 16 ноября 2026

Итоговая квалификация PR #15 поверх main@500461d, включая последующие
исправления входа и истории, приведена в [текущей стадии](current-stage.md).
Ниже сохранён аудит предыдущего прикладного кандидата; его результаты
не подменяют проверки интегрированного 9d70e1a.

## Финальный аудит после повторного ревью

Прикладной кандидат **b2f17f573a9704840b655f1253ef8ec75a089a12**, ветка
fix/frontend-audit-boundaries поверх main@24702c0. Последующие изменения
документации и уточнение селектора теста не меняют код приложения.
Все три замечания повторного ревью закрыты; новых подтверждённых P0/P1/P2
в проверенных границах финального diff не осталось.

| ID     | Итог                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1, P2 | Реестр и история приостанавливают измерение при ошибке чтения. В исходном IAB-воспроизведении теперь один GET вместо 130 дополнительных; size и три строки сохранены. Nginx-тесты проверяют refetch, polling, отсутствие скрытых повторов и обычный resize после восстановления.                                                                                                                                                             |
| R2, P2 | Команда и read recovery имеют одного владельца useReconciliation; pending/неизвестный исход включены в guard страницы. На разборе используется существующий guard решения, без второго blocker. Проверены task/issue/saved snapshot, POP, beforeunload handler, отмена ухода с тем же ключом, явный отказ и страница без полей решения. Черновик не теряется после принятой сверки; фокус возвращается к действию, открывшему подтверждение. |
| R3, P3 | Недоступная страница непустого списка имеет отдельное сообщение и переход к первой странице с сохранением фильтров. Проверены настоящий пустой список, пустой фильтр и роли инициатора/оператора; оператору не предлагается создавать задание.                                                                                                                                                                                               |

Архитектурный проход подтвердил прежние границы app → features → shared.
QueryClient владеет чтениями, URL — фильтрами и страницей, API hooks —
идентичностью команд, страница — защитой навигации. Исправления R1–R3 не добавляют
stores, фоновых процессов, постоянного кэша DTO, fallback-протоколов и зависимостей.
Проверены связанные consumers, асинхронные callbacks, очистка сессии,
блокировка одновременных действий и lifecycle возврата фокуса.

Проверки кандидата: build/format/codegen/ESLint/strict TypeScript PASS;
**64 unit, 2 asset, 136 component, 8 production Nginx, 76 real API UI,
4 HTTP smoke — PASS**. Во всём frontend dependency tree 0 известных advisories.
Из UI-сценариев 75 прошли полным прогоном; desktop UI-09 успешно повторён
после уточнения селектора heading/navigation для нового сообщения R3.
Приложение между ними не менялось; остальные пройденные сценарии не повторялись.

Локальный frontend на http://127.0.0.1:19673 собран из b2f17f5; backend/emulator
остаются на 1d0b826 с неизменными inputs. Проверены отдаваемые JS/CSS,
ревизии образов, nonce HTML/CSP и API. Все 706 исходных заданий, 705 внешних
операций и контрольные суммы защищённых бизнес-строк сохранены. 113 собственных
fixtures удалены по манифесту; оба immutable audit triggers восстановлены.
Повтор UI-09 использовал существующий реестр и новых заданий не создавал.

Доказательства последней квалификации:

- [Итоговая сводка проверок](../tests/results/frontend-final-audit-2026-11-16/qualification.json).
- [Интегрированные наборы и UI-прогон](../tests/results/frontend-final-audit-2026-11-16/post-review.log).
- [Исправленный UI-09, smoke и финальный PASS](../tests/results/frontend-final-audit-2026-11-16/completion.log).
- [Ревизии образов, ресурсы и API](../tests/results/frontend-final-audit-2026-11-16/runtime-verification.json).
- [Сохранность и очистка данных](../tests/results/frontend-final-audit-2026-11-16/fixture-cleanup-receipt.json).
- [IAB-воспроизведения](../tests/results/frontend-final-audit-2026-11-16/iab-verification.json).
- [IAB реально обновлённого приложения](../tests/results/frontend-final-audit-2026-11-16/iab-served-application.json).
- [Dependency audit](../tests/results/frontend-final-audit-2026-11-16/dependency-audit.json).

Это локальная квалификация Chromium desktop/mobile; Safari/Firefox, физические
устройства, полная WCAG-приёмка и публичный production в этот прогон не входят.
Ниже сохранены результаты предыдущих этапов с их собственными кандидатами.

## Предыдущая квалификация исправлений F01–F06

Все шесть замечаний исходного аудита исправлены в fix/frontend-audit-boundaries
поверх актуального main@24702c0. Прикладной кандидат —
4a50406513d6950b606058e8579d513f2b78db15 (коммиты 1d0b826 и 4a50406).
Ниже этой секции сохранены исходные находки и ограничения именно этапа аудита.

| ID  | Исправление и подтверждение                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | Auth policy связывает команды с поколением сессии. Поздний 401 старой команды не завершает новую identity; актуальный 401 по-прежнему завершает сессию. Unit и реальные provider/component сценарии проверяют обе стороны.                                    |
| F02 | Квитанция сверки проверяется до success и перехода. Неизвестный исход сохраняет исходный ключ и безопасный повтор; явные 400/401/403/404/409 остаются отказами. Проверены неверные ID, чужое задание, 404, 503, отказ CSRF и replay с тем же ключом.          |
| F03 | Vite/Nginx/get-nonce согласованы через nonce на документ. HTML имеет no-store без ETag/304, hashed assets сохраняют годовой кэш. На настоящем Nginx проверены CSP, Select, вложенные диалоги, блокировка прокрутки и условные запросы без unsafe-inline.      |
| F04 | Секунды и наносекунды точной URL-границы видны в подсказке; запрос сохраняет исходную точность. Редактирование минутного поля явно меняет только свою границу. Проверены период в 1 ns, desktop и mobile.                                                     |
| F05 | Desktop main владеет своей прокруткой: новый экран сверху, POP восстанавливает позицию после загрузки. Search/pagination того же экрана не сбрасывают внешний scroll; mobile feed сохраняет прежнего владельца. Проверены cold/warm, Back/Forward и Query GC. |
| F06 | Узкий override minimatch 11.0.8 для typescript-estree 8.72.2 устраняет advisory; условие удаления записано рядом. Положительные/отрицательные lint fixtures проходят, dependency audit: 0 известных уязвимостей.                                              |

На 4a50406 прошли format/codegen/ESLint/strict TypeScript/Vite build,
64 unit, 2 asset, 126 component, 5 production Nginx, 76 real API UI и 4 HTTP smoke теста.
Локальный frontend на http://127.0.0.1:19673 обновлён до этого кандидата.
Backend/emulator квалифицированы на 1d0b826; их inputs побайтно неизменны
в 4a50406. Проверка через IAB подтвердила видимые точные фильтры на desktop
и 390 px, отсутствие горизонтального переполнения и чтение существующей истории.

113 собственных fixtures последнего прогона удалены по точному манифесту.
Исходные 706 заданий, 705 внешних операций и контрольные суммы защищённых
бизнес-строк сохранены. Публичное окружение не изменялось.

Локальные доказательства последнего прогона:

- [Сборка и все тестовые наборы](../tests/results/frontend-audit-fixes-2026-11-16/final/post-review.log).
- [Проверка зависимостей](../tests/results/frontend-audit-fixes-2026-11-16/final/dependency-audit.json).
- [Очистка собственных fixtures](../tests/results/frontend-audit-fixes-2026-11-16/final/fixture-cleanup-receipt.json).
- [IAB-проверка](../tests/results/frontend-audit-fixes-2026-11-16/final/iab-verification.json).
- [Отдаваемые JS/CSS, nonce, image revisions и реальный API](../tests/results/frontend-audit-fixes-2026-11-16/final/runtime-verification.json).

## Исходный результат и границы заключения

Проверен `main` **24702c0fe4faee036bc56bd17efa8e10d8d48062**. Найдены пять
дефектов P2 и одно замечание P3 по зависимости инструментария. Подтверждённых
P0/P1 в исследованных сценариях нет; это не заявление об отсутствии любых
уязвимостей или ошибок.

Архитектурную основу можно сохранять: app → features → shared, один QueryClient,
предметные API-модули, URL как владелец фильтров, локальные формы и общие UI-примитивы.
Полная перепись, обязательный Redux, новый framework валидации или дополнительные
слои не обоснованы. Основные проблемы находятся на границах асинхронных операций,
авторизации, представления точных дат и владения прокруткой.

Это аудит, а не исправление или разрешение релиза. Прикладные исходники не изменены,
коммиты, PR и deployment не выполнялись. Локальный main безопасно обновлён fast-forward.
Существовавшие `backend/.gradle/` и `backend/emulator/` сохранены.

### Актуальность версии

Исследование начиналось на 223bc86. Во время аудита в main вошли PR #9–#12.
После обновления проверены их изменения frontend и OpenAPI; форматирование
отделено от изменений поведения сравнением исходников после одинакового Prettier.
На итоговой версии заново прошли codegen, lint, typecheck, format и 60 unit-тестов;
повторены сценарии гонки сессии, неверной квитанции и точного фильтра.

Новый main уже исправляет невозможные календарные даты, нормализацию offset в UTC,
точность сравнения периода и границы int32 для номера страницы. Эти исправленные
проблемы **не включены** в открытые замечания. Остаточная проблема отображения
долей секунды описана отдельно в F04.

## Замечания исходного аудита

| ID  | Приоритет | Проблема                                                                    | Владелец                                  |
| --- | --------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| F01 | P2        | Поздний 401 старой команды завершает новую сессию                           | Auth lifecycle / global mutation callback |
| F02 | P2        | Некорректная квитанция сверки считается успехом, теряется безопасный повтор | Operations API command                    |
| F03 | P2        | Production CSP несовместима со стилями scroll lock модальных окон           | CSP / shared modal integration            |
| F04 | P2        | Точный фильтр API отображается с потерей секунд и дробной части             | Task URL model / date editor              |
| F05 | P2        | Новый закэшированный экран наследует прокрутку предыдущего                  | App shell / routing                       |
| F06 | P3        | Moderate advisory в dev-зависимости minimatch 10.2.6                        | Frontend toolchain                        |

P2 — воспроизводимая ошибка поведения, которую следует исправить обычным
приоритетом. P3 — ограниченный риск или улучшение; severity advisory и приоритет
исправления в этом приложении не тождественны.

### F01. Поздний 401 старой команды завершает новую сессию

**Код:** [providers.tsx](../frontend/src/app/providers.tsx), строки 12–15;
[session-policy.ts](../frontend/src/features/auth/model/session-policy.ts), строки 8–12 и 32–33.

Global MutationCache.onError передаёт любой ApiError(401) в clearSession.
При принятии другой identity private cache очищается, но удаление mutation из
кэша не отменяет уже выполняющуюся команду и её глобальные callbacks.
В установленном query-core 5.107.1 этот callback вызывается в обработчике catch
mutation независимо от её присутствия в MutationCache.

**Воспроизведение в IAB на настоящих production-компонентах:**

1. В сессии A начать PATCH переименования и задержать его ответ.
2. Вернуть из GET /api/session пользователя B и дождаться B в шапке.
3. Доставить отложенный 401 от команды A.
4. SPA показывает вход, хотя mock server сохраняет `signedIn=true` и account B.

Повторено на итоговом main. Это ложное завершение новой сессии; утечка данных
между пользователями данным сценарием не установлена.

**Минимальное направление:** auth-владелец связывает асинхронный failure с identity
или поколением сессии, в котором начата операция. Ошибка старой сессии не должна
завершать новую. Текущий 401 по-прежнему обязан очищать приватные данные;
нельзя просто игнорировать 401 или отключать общий обработчик.

**Регрессия:** A → B и смена роли при pending mutation; старые 401 и success;
401 актуальной identity; повторный вход того же пользователя. Проверять и очистку
старого черновика, и доступность содержимого новой сессии, а не только новую шапку.

**Доказательства:** [снимок](../tests/results/frontend-full-audit-2026-11-16/late-401-final.jpg),
[состояние mock API](../tests/results/frontend-full-audit-2026-11-16/late-401-final-state.json).

### F02. Неверная квитанция сверки считается успешной

**Код:** [exchange-commands.ts](../frontend/src/features/operations/api/exchange-commands.ts), строки 15–20;
[reconcile-button.tsx](../frontend/src/features/operations/ui/reconcile-button.tsx), строки 18–24.

HTTP boundary проверяет статус и синтаксис JSON, но не обязательный ID квитанции.
Для 200 с телом `{}` useReconcileTask вызывает onSuccess и сбрасывает ключ.
После успешного перечитывания ReconcileButton открывает
`/tasks/<id>/reconciliations/undefined` и показывает ошибку чтения.

В mock API первая команда уже создала сверку. После возврата и повторного нажатия
получены **два POST с разными Idempotency-Key и две сверки**. Это не доказательство,
что штатный backend сейчас возвращает `{}`; это подтверждённое неправильное
восстановление frontend при нарушенном success-контракте.

Создание задания уже защищено проверкой taskId и состоянием неизвестного исхода.
Для сверки такая граница отсутствует.

**Минимальное направление:** проверить необходимую для дальнейшего сценария
квитанцию до признания команды успешной и сброса ключа. При неизвестном исходе
сохранять исходную команду и ключ, показывать понятное восстановление, не строить
маршрут из непроверенного значения. Не требуется валидировать все DTO новым framework.

**Регрессия:** `{}`, неверный/отсутствующий reconciliationId, обрыв JSON и сети;
валидный replay той же команды; failure последующего GET. GET retry не должен
выполнять ещё один POST.

**Доказательства:** [снимок](../tests/results/frontend-full-audit-2026-11-16/malformed-reconciliation-final.jpg),
[два ключа и счётчик команд](../tests/results/frontend-full-audit-2026-11-16/malformed-reconciliation-final-state.json).

### F03. CSP блокирует CSS блокировки прокрутки

**Код:** [nginx.conf](../frontend/nginx.conf), строка 13;
[dialog.tsx](../frontend/src/shared/ui/dialog.tsx), Radix Portal/Overlay/Content;
runtime-зависимости react-remove-scroll-bar и react-style-singleton.

`style-src 'self'` запрещает создаваемый библиотекой inline `<style>` без nonce/hash.
В нём находится правило `body[data-scroll-locked] { overflow: hidden !important; ... }`.
Vite и существующий component runner не используют этот production-заголовок.

В IAB сравнен один dist и один mock API на двух loopback origins, с точной CSP
из nginx.conf и без неё. При открытых фильтрах на 390 × 844:

| Измерение                   | С production CSP | Контроль без CSP |
| --------------------------- | ---------------- | ---------------- |
| body[data-scroll-locked]    | 1                | 1                |
| computed body overflow      | visible          | hidden           |
| documentElement.clientWidth | 375              | 390              |
| innerWidth                  | 390              | 390              |

Полоса прокрутки документа остаётся видна под модальным окном. Popup Select
при этом открывается: нельзя делать вывод, что CSP ломает все стили или весь Radix.
JavaScript-обработчики библиотеки могут отдельно ограничивать wheel/touch;
успешная прокрутка фона жестом в этом аудите не доказана.

**Ограничение доказательства:** использован существующий dist от предыдущей
квалификации, не свежий образ итогового main. Nginx CSP, modal integration и
задействованные runtime-зависимости в итоговом main семантически не изменились.
Это воспроизводимая production-header проба, а не приёмка реального Nginx deployment.

**Минимальное направление:** согласовать CSP и штатный механизм dynamic styles
библиотеки: nonce/hash с корректным владельцем либо поддерживаемые статические
правила scroll lock. Не ослаблять script-src и не добавлять unsafe-inline без разбора.

**Регрессия:** настоящий production build с production headers, длинный документ,
Dialog → Select → закрытие, вложенный AlertDialog, восстановление фокуса и размеров;
mobile и desktop. Нужна отдельная проверка production, а не только Vite fixture.

**Доказательства:** [CSP](../tests/results/frontend-full-audit-2026-11-16/csp-filter-modal.jpg),
[контроль](../tests/results/frontend-full-audit-2026-11-16/control-filter-modal.jpg),
[метрики CSP](../tests/results/frontend-full-audit-2026-11-16/strict-csp-metrics.json),
[метрики контроля](../tests/results/frontend-full-audit-2026-11-16/control-csp-metrics.json),
[HTTP headers](../tests/results/frontend-full-audit-2026-11-16/strict-headers.json).
Правило подтверждено [спецификацией CSP](https://www.w3.org/TR/CSP3/#directive-style-src)
и [документацией style-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src).

### F04. Редактор скрывает точную границу периода

**Код:** [task-search.ts](../frontend/src/features/tasks/model/task-search.ts), строки 62 и 69–70;
[task-filters.tsx](../frontend/src/features/tasks/ui/task-filters.tsx), строки 44–65.

В итоговом main API-параметры корректно сохраняют секунды и до девяти знаков
дробной части, но utcFilterValue отрезает их через slice(0, 16).
URL `createdFrom=2026-11-16T07:30:45.123456789Z` применяется с точной границей,
а поле показывает `2026-11-16T07:30`. Изменение этого поля формирует уже минутную
границу с `:00Z` и теряет исходную точность.

Особенно заметен валидный полуоткрытый наносекундный период: начало и конец
отличаются в API, а на экране выглядят одинаковыми. Новые unit-тесты проверяют
точное сравнение периода и UTC offset, но не соответствие такого периода редактору.

**Минимальное направление:** явно определить точность редактора и показывать
реально применённые условия. Если UI остаётся минутным, точный URL нельзя молча
представлять как минутный: нужны видимые точные значения и явное преобразование
при редактировании. Если поддерживаются точные timestamps, редактор должен их
сохранять. Не округлять API-параметры незаметно ради совпадения картинки.

**Регрессия:** целая минута, секунды, миллисекунды и наносекунды; обе границы,
offset → UTC, ввод через URL, открытие/закрытие фильтров без редактирования.

**Доказательство:** [DOM итогового main](../tests/results/frontend-full-audit-2026-11-16/date-precision-final.json).
Ранее найденная проблема невозможных дат исправлена в main и не является частью F04.

### F05. Маршрутизация и desktop-прокрутка имеют разных владельцев

**Код:** [app-shell.tsx](../frontend/src/app/shell/app-shell.tsx), строки 26–39;
[shell.css](../frontend/src/app/shell/shell.css), строки 184–190.

Desktop задаёт `main { overflow: auto }`, но ScrollRestoration обслуживает окно.
При переходе к уже закэшированной странице main сохраняет прежний scrollTop.
Загрузочный экран иногда обнуляет его за счёт уменьшения содержимого, поэтому
первый и повторный переходы ведут себя по-разному.

В IAB при 1280 × 480: открыть завершённый разбор, перейти по нижней ссылке
«Сверка, на которой основано решение», вернуться, повторить переход. При первом
открытии сверки main.scrollTop=0; при повторном — 95, window.scrollY=0,
h1.top=19 при нижней границе шапки около 81. Заголовок, стрелка назад и действие
новой страницы находятся выше видимой области main.

**Минимальное направление:** оболочка должна владеть навигационной прокруткой
того контейнера, который действительно прокручивается: новый экран начинается
сверху, POP восстанавливает согласованную позицию. Не смешивать это с владельцем
локальной пагинации или mobile feed; не исправлять отдельные ссылки таймерами.

**Регрессия:** холодный и тёплый кэш, короткая/длинная карточка, низкое окно,
Back/Forward, переход между деталями и возврат в реестр с фильтрами. Mobile с
прокруткой документа должен сохранять своё существующее поведение.

**Доказательства:** [снимок](../tests/results/frontend-full-audit-2026-11-16/cached-route-scroll-final.jpg),
[метрики](../tests/results/frontend-full-audit-2026-11-16/cached-route-scroll-final.json).

### F06. Advisory в инструментальной зависимости

**Код:** [pnpm-lock.yaml](../frontend/pnpm-lock.yaml), строки 1977 и 3893.

`pnpm audit --prod --json`: известных advisories не найдено.
Полный `pnpm audit --json`: один moderate — minimatch 10.2.6,
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249),
через @typescript-eslint/typescript-estree в двух ESLint plugin chains.

У advisory есть условие: контролируемый атакующим glob и optimizationLevel ≥ 2.
Здесь пакет инструментальный, production bundle не использует его; удалённая
эксплуатация приложения не установлена. Это P3 по актуализации toolchain,
а не критическая уязвимость браузерного приложения.

**Направление:** обновить совместимую родительскую зависимость либо проверить
предметное исправление дерева. Не применять принудительный major override без
проверки ESLint, negative architecture fixtures и сборки.

**Доказательства:** [production audit](../tests/results/frontend-full-audit-2026-11-16/dependency-audit.json),
[полный audit итогового main](../tests/results/frontend-full-audit-2026-11-16/dependency-audit-all-final.json).

## Архитектура и область проверки

Инвентаризация итогового main: 97 прикладных TS/TSX/CSS-файлов в frontend/src,
без generated-клиента и тестов. Основные границы прочитаны с потребителями,
OpenAPI, installed runtime source и тестами, а не оценены по названиям каталогов.

```text
frontend/src/
  app/                 providers, router, shell, theme, error boundaries
  features/
    auth/              api, session policy, login
    tasks/             api, URL/list models, forms, history, presenters
    operations/        api, decision model, issue/reconciliation UI
  shared/
    api/               HTTP decoding, CSRF
    lib/               collections, forms, pagination, router, formatting
    ui/                доступные поля, диалоги, таблицы, feedback
    styles/            tokens, controls, layout, patterns
```

Это подходящая проектная структура, а не единственная официальная структура React.
Владение state согласуется с [рекомендациями React](https://react.dev/learn/choosing-the-state-structure):
серверные DTO принадлежат Query, фильтры — URL, черновики — форме. Снимок revision
в черновике является намеренной базой команды, а не ошибочным дублированием props.
Идентичность формы задаётся key по сущности и identity, как предусмотрено
[React state identity](https://react.dev/learn/preserving-and-resetting-state).

| Область          | Что проверено                                                                                                       | Вывод / ограничение                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Слои и импорты   | App composition, feature ownership, публичные входы между features, generated requests только в API                 | Сохранять; ESLint проверяет направление зависимостей, циклы и Hooks. Не нужен дополнительный service/repository слой во frontend.                                         |
| React lifecycle  | StrictMode, query provider lifetime, cleanup observers/listeners/RAF, формы при смене ID                            | Основа согласована; F01 — оставшийся async lifetime gap. StrictMode отключать не следует.                                                                                 |
| API contract     | Orval, DTO imports, HTTP errors/empty/broken bodies, AbortSignal, CSRF, command headers                             | Централизация разумна; F02 показывает конкретную непроверенную success-границу.                                                                                           |
| Авторизация      | Role routes, скрытие действий, session retry, смена identity, private cache и metadata                              | F01. Frontend guards не заменяют проверку прав backend. Новый security penetration test backend не выполнялся.                                                            |
| Команды          | Idempotency-Key, expected revisions, draft basis, отделение accepted write от failed follow-up GET                  | Модель полезна; F02. Не добавлять автоматические повторы POST как общий сетевой fallback.                                                                                 |
| Формы            | Native required/pattern/range, disabled fieldsets, dirty guards, discard dialog, task identity                      | На 320 px форма создания и discard → continue → create отработали на mock API. Logout-политика требует отдельного решения, см. ниже.                                      |
| Query/cache      | Один QueryClient, keys у features, abort чтений, invalidation, явные retries                                        | Не найдена причина вводить второй server-state store. Global auth callback требует identity scope.                                                                        |
| Списки           | Desktop измерение size, URL filters/page, int32 page boundary, out-of-range recovery                                | Исходники и unit-проверки; новые 112 component cases перечислены, но свежий запуск не завершён.                                                                           |
| Mobile feeds     | IntersectionObserver, maxPages=5, до 100 записей, оба направления, metadata до 32 коллекций                         | Есть конечный бюджет и отдельный владелец позиции; не копировать pages в useState. Это source-level assessment, не memory benchmark.                                      |
| Polling          | Активные задания 3 s, settled/review 10 s, ограниченный refetch окна                                                | Нет неограниченного полного перечитывания истории. Снижение интервала без измерения не предлагается.                                                                      |
| Навигация        | Общий route tree, icon-only back с доступным именем, list return context, формы и cache                             | F05. Восстановление window и desktop main необходимо согласовать.                                                                                                         |
| UI/UX            | Login, задачи, создание, карточка/история, разборы, разбор, сверка, loading/error recovery                          | IAB + isolated mock API; проверены 320/390 px и desktop 1280 px, включая низкое окно. Не утверждается проверка всех состояний на всех размерах.                           |
| Accessibility    | Labels/required, именованные icon buttons, table semantics, Radix dialogs, native bridge aria-hidden, focus styles  | Базовая семантика есть. Нет новой полной NVDA/VoiceOver, Safari, touch keyboard или WCAG-сертификации.                                                                    |
| CSS/темы         | Общие tokens/controls/patterns, локальные composition styles, mobile overflow, modal portals                        | На осмотренных mobile экранах горизонтального overflow не найдено. F03 относится к production headers. Полная инструментальная проверка всех цветовых пар не выполнялась. |
| Browser security | React text output, отсутствие dangerouslySetInnerHTML/eval в src, storage только theme/feed metadata, CSP и headers | Не найдены очевидные XSS sinks или хранение credentials в browser storage. F03; это не результат полноценного pentest.                                                    |
| Dependencies     | Lockfile, production/dev audit, доступные advisory details                                                          | F06; zero production advisories не доказывает отсутствие неизвестных уязвимостей.                                                                                         |
| Build/deployment | Vite lazy routes, gzip assets, Nginx SPA fallback/cache/headers, Docker inputs                                      | Две asset-проверки старого dist прошли. Итоговый build/container/readback не квалифицированы заново.                                                                      |
| Тесты            | Unit/lint fixtures, browser component suite, существующие E2E contracts                                             | Fresh 60 unit; 112 component tests доступны. Недостающие сценарии F01–F05 перечислены у каждого finding.                                                                  |

## Наблюдения, не выданные за дефекты

- Выход из inline-редактора через «Выйти» удаляет черновик без DiscardDialog.
  Поведение воспроизведено, но logout является явным завершением сессии, а отдельного
  требования подтверждать его в контракте нет. Нужна продуктовая политика; при
  подтверждённом выходе приватные черновики должны очищаться, а не сохраняться ради UX.
- При переходе SPA h1 не получает явный focus и document title не обновляется
  по каждому экрану. Это область дальнейшей a11y-проверки со screen reader;
  клавиатурная ловушка или конкретное нарушение WCAG этим аудитом не доказаны.
- UUID ответственного всё ещё используется в разборе. Для операторской работы
  логин был бы понятнее, но это потребует согласованного API-поля/маппинга;
  frontend не должен придумывать имя из UUID или иметь отдельный справочник истины.
- Issue detail не имеет такого же polling, как task/history. Это существующая
  явная политика; без требования freshness не объявляется отдельным дефектом.
- Размеры старого dist не являются замером итогового bundle или Core Web Vitals.
  React Profiler, Lighthouse, heap snapshots и real-device performance не запускались.
- Page out-of-range имеет явное сообщение и путь возврата. Старое утверждение
  об отсутствии recovery не подтверждено текущим кодом.
- Нет основания вводить FSD целиком, обязательный memo/useCallback на каждом
  компоненте, form framework или тотальную runtime DTO-валидацию ради «best practices».

## Проверки и происхождение доказательств

| Проверка                                | Результат в этом аудите      | Кандидат / оговорка                                                                     |
| --------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| Prettier format:check                   | PASS                         | Итоговый main                                                                           |
| Orval generate:api                      | PASS                         | Итоговый OpenAPI                                                                        |
| ESLint                                  | PASS                         | Итоговый main, без предупреждений                                                       |
| TypeScript strict                       | PASS                         | Итоговый main после codegen                                                             |
| Node unit                               | 60 PASS, 0 fail/skip         | Итоговый main                                                                           |
| pnpm audit --prod                       | 0 advisories                 | Production dependency tree; runtime deps не менялись между исследованными main          |
| pnpm audit all                          | 1 moderate, dev-only         | Итоговый main, F06                                                                      |
| Asset consistency / fixture exclusion   | 2 PASS                       | Существующий dist предыдущей квалификации                                               |
| Component test discovery                | 112 tests / 6 files          | Только --list, не PASS выполнения                                                       |
| Новый production build + component gate | Не завершён                  | Два общих host execution slots заняты внешними квалификациями                           |
| Новый real API E2E / container          | Не выполнялся                | Existing load backend не аттестован как итоговый commit; чужой runtime не пересобирался |
| Production CSP browser probe            | Подтверждена несовместимость | Существующий dist, точный CSP header, isolated mock API                                 |
| Публичный/production runtime            | Не проверялся и не изменялся | Локальный аудит не является production-приёмкой                                         |

Первый допущенный запуск build остановился на CRLF в 20 старых неизменённых
файлах checkout после обновления `.gitattributes`. Git blobs уже содержали LF.
Проверено побайтное совпадение содержимого с Git после удаления CRLF; восстановлены
только эти чистые inputs. Прикладной и staged diff пусты, format:check проходит.
Это устранённое локальное состояние checkout, а не открытый дефект main.
Повторный полный gate не был допущен из-за занятых слотов. Его нельзя считать зелёным.

Предыдущие 74 E2E и 110 component PASS описаны в [current-stage.md](current-stage.md)
для другого квалифицированного кандидата. Они полезны как история и область
регрессии, но не заменяют свежий запуск на 24702c0, где тестов уже 112.

Все новые browser-взаимодействия выполнялись только через Codex in-app Browser.
Fault injection использовал настоящие appRoutes/providers/components и отдельный
mock API на 19775; production-header control — 19776/19777. Эти origins не
обращались к реальной БД или load backend. Созданные записи синтетические.

Локальные receipts, снимки и harness находятся в ignored
`tests/results/frontend-full-audit-2026-11-16/` и `.local/frontend-full-audit/`.
Они не входят в production bundle. Основные журналы:

- [Итоговые codegen/lint/typecheck/unit](../tests/results/frontend-full-audit-2026-11-16/static-final.log).
- [Итоговое форматирование](../tests/results/frontend-full-audit-2026-11-16/format-check-final.log).
- [Список 112 component tests](../tests/results/frontend-full-audit-2026-11-16/components-list.log).
- [Проверка существующих assets](../tests/results/frontend-full-audit-2026-11-16/existing-assets-check.log).
- [SHA256 served artifact и локального dist](../tests/results/frontend-full-audit-2026-11-16/served-artifact-receipt.json).
- [Последний отказ допуска полного gate](../tests/results/frontend-full-audit-2026-11-16/final-gate-admission.log).
- [Разделение нового поведения и форматирования](../tests/results/frontend-full-audit-2026-11-16/latest-main-changes.json).

## Исходный порядок исправлений и повторной проверки

1. F01: привязать async auth failures к исходной сессии. Добавить тест на новый
   аккаунт с поздним ответом старой команды и соседний current-session 401.
2. F02: проверять receipt сверки до success и сохранять безопасное восстановление.
   Проверить количество POST, одинаковый ключ replay и отсутствие invalid-ID GET.
3. F03: согласовать CSP с modal integration и добавить production-header проверку.
4. F05: определить владельца desktop scroll и проверить cold/warm navigation,
   POP и сохранение mobile feed.
5. F04: согласовать видимую и применяемую точность фильтров без скрытого округления.
6. F06: обновить dev dependency совместимым способом и повторить lint fixtures.
7. На интегрированном результате выполнить один полный frontend build, unit,
   asset и component gate; затем real API E2E на аттестованном изолированном стенде
   и IAB-проверку итогового served artifact с production headers.

Для снятия ограничения текущей проверки требуется свободный общий host execution
slot. В `.local/frontend-full-audit/gate.ps1` подготовлен последовательный gate;
он запускается через существующий общий execution_slot.py. Ограничение не
обходилось отдельным пулом, raw build или остановкой чужой задачи. Это инструкция
для возобновления проверки, а не обещание несуществующего фонового продолжения.
