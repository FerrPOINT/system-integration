import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { getSession } from '../../../../build/generated/openapi/client';
import { data } from '../../../shared/api/http';
import { acceptSession, sessionKey } from '../model/session-policy';

export const sessionOptions = queryOptions({
  queryKey: sessionKey,
  // QueryFunctionContext supplies this provider's client; there is no global cache.
  queryFn: async ({ client, signal }: { client: QueryClient; signal: AbortSignal }) =>
    acceptSession(client, await data(getSession({ signal }))),
  staleTime: 0,
});
