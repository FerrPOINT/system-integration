import { useSearchParams } from 'react-router-dom';
import type { Task } from '../../../../build/generated/openapi/client';
import { useCollectionQuery } from '../../../shared/lib/collections/use-collection-query';
import { usePagination } from '../../../shared/lib/pagination/use-pagination';
import { taskKeys } from '../api/task-keys';
import { readTaskPage } from '../api/task-queries';
import { changeTaskFilters, parseTaskSearch } from './task-search';

const identifyTask = (task: Task) => task.taskId;

export function useTaskList(mobile: boolean) {
  const [search, setSearch] = useSearchParams();
  const pagination = usePagination(mobile ? 'feed' : 'pages');
  const filters = parseTaskSearch(search);
  const validParameters = pagination.valid && filters.validParameters;
  const valid = validParameters && filters.validPeriod;
  const collection = useCollectionQuery({ key: taskKeys.taskList(filters.params), page: pagination.page, size: pagination.size, feed: mobile, enabled: valid,
    read: (page, size, signal) => readTaskPage({ ...filters.params, page, size }, signal), identify: identifyTask });
  return { search, pagination, filters, validParameters, valid, collection,
    changeFilters: (changes: Record<string, string | undefined>) => setSearch(changeTaskFilters(search, changes), { replace: true }),
    resetFilters: (replace = true) => setSearch({}, { replace }),
  };
}
