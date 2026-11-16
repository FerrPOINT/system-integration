import { queryOptions } from '@tanstack/react-query';
import { getTask, listTasks, listTaskHistory } from '../../../../build/generated/openapi/client';
import type { ListTasksParams } from '../../../../build/generated/openapi/client';
import { data } from '../../../shared/api/http';
import { taskKeys } from './task-keys';
import { taskRefreshInterval } from '../model/refresh-interval';

export const taskOptions = (id: string) =>
  queryOptions({
    queryKey: taskKeys.task(id),
    queryFn: ({ signal }) => data(getTask(id, { signal })),
    refetchInterval: (query) => taskRefreshInterval(query.state.data),
  });

export const readTaskPage = (params: ListTasksParams, signal: AbortSignal) => data(listTasks(params, { signal }));
export const readHistoryPage = (id: string, page: number, size: number, signal: AbortSignal) =>
  data(listTaskHistory(id, { page, size }, { signal }));
