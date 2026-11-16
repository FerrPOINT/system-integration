import { useQueryClient } from '@tanstack/react-query';
import { getCsrfToken } from '../../../build/generated/openapi/client';
import type { GetSession200 } from '../../../build/generated/openapi/client';
import { data, RequestPreconditionError } from './http';
import { sessionGeneration, sessionKey } from './session-scope';

/** A rendered command keeps its owner while CSRF or an auth lock is pending. */
export function useSessionCommand() {
  const client = useQueryClient();
  const generation = sessionGeneration(client);
  const owner = client.getQueryData<GetSession200 | null>(sessionKey)?.userId;
  const requireCurrent = () => {
    if (sessionGeneration(client) !== generation)
      throw new RequestPreconditionError('Сессия изменилась. Повторите действие в текущей учётной записи.');
  };
  return async <T>(write: (headers: { 'X-CSRF-TOKEN': string }) => Promise<T>) => {
    requireCurrent();
    const token = await data(getCsrfToken());
    requireCurrent();
    if ((token.userId ?? null) !== (owner ?? null)) {
      void client.invalidateQueries({ queryKey: sessionKey });
      throw new RequestPreconditionError('Сессия изменилась. Повторите действие в текущей учётной записи.');
    }
    return write({ 'X-CSRF-TOKEN': token.token });
  };
}
