# История разработки

Актуальное устройство системы описано в [архитектуре](architecture.md),
обязательный объём — в [требованиях](requirements.md), проверенные версии —
в [текущей стадии](current-stage.md). Эти документы задают действующее поведение.

Завершённые планы и аудиты сохранены по неизменяемой версии Git.
Они объясняют принятые решения и исходные замечания, но не являются инструкцией
для текущего запуска. Старые оценки производительности относятся к своим
кандидатам и не заменяют последующую квалификацию.

| Материал | Сохранённая версия |
| --- | --- |
| Исходный аудит frontend | [Документ в Git](https://github.com/FerrPOINT/system-integration/blob/500461d1737b98524ba618bac717d09fc34f7127/docs/frontend-architecture-audit-2026-11-14.md) |
| Аудит интерфейса и адаптивности | [Документ в Git](https://github.com/FerrPOINT/system-integration/blob/500461d1737b98524ba618bac717d09fc34f7127/docs/ui-ux-audit-2026-11-14.md) |
| Итеративный аудит и регрессии | [Документ в Git](https://github.com/FerrPOINT/system-integration/blob/500461d1737b98524ba618bac717d09fc34f7127/docs/iterative-audit-2026-11-15.md) |
| Завершённый рефакторинг frontend | [Документ в Git](https://github.com/FerrPOINT/system-integration/blob/500461d1737b98524ba618bac717d09fc34f7127/docs/frontend-refactoring-plan.md) |
| Системный аудит и исправления backend | [Документ в Git](https://github.com/FerrPOINT/system-integration/blob/500461d1737b98524ba618bac717d09fc34f7127/docs/backend-audit-followup-plan.md) |
| Выделение серверных слоёв | [Документ в Git](https://github.com/FerrPOINT/system-integration/blob/500461d1737b98524ba618bac717d09fc34f7127/docs/spring-boot-refactoring-plan.md) |
| Настройка Spring Boot | [Документ в Git](https://github.com/FerrPOINT/system-integration/blob/500461d1737b98524ba618bac717d09fc34f7127/docs/spring-boot-hardening-plan.md) |
| Введение Spring Data JDBC для чтения | [Документ в Git](https://github.com/FerrPOINT/system-integration/blob/500461d1737b98524ba618bac717d09fc34f7127/docs/spring-data-read-plan.md) |
| Оптимизация чтения и фонового обмена | [Документ в Git](https://github.com/FerrPOINT/system-integration/blob/500461d1737b98524ba618bac717d09fc34f7127/docs/read-path-performance-plan.md) |

Подробный [журнал экспериментов по производительности](exchange-performance-plan.md)
сохраняется отдельно: в нём записаны причины принятия и отклонения решений.
[Декомпозиция](decomposition.md) связывает завершённые этапы с критериями проверки.

Frontend-аудит и интеграция PR #15: [аудит](https://github.com/FerrPOINT/system-integration/blob/caa25fbedf59e5a079e4d6c18747bceac34aa6f8/docs/frontend-full-audit-2026-11-16.md),
[квалификация](https://github.com/FerrPOINT/system-integration/blob/caa25fbedf59e5a079e4d6c18747bceac34aa6f8/docs/current-stage.md).


Квалификация типизации и общего UI после PR #16 сохранена
в [документе main 1125b7f](https://github.com/FerrPOINT/system-integration/blob/1125b7fd43cb57a71284be2586c544a16660e252/docs/current-stage.md).
Актуальная стадия не дублирует результаты этих завершённых итераций.
