-- A paused reader is an incident. Keep existing IDs, evidence and operator decisions.
UPDATE exchange_issues
SET scope = 'feed-page'
WHERE scope = 'feed'
  AND task_id IS NULL
  AND operation_id IS NULL
  AND kind = 'RESULT_CONFLICT'
  AND summary = 'Некорректная структура страницы или позиция ленты';
