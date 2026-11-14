import { useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expireSession } from '../features/auth/model/session-policy';

export function createQueryClient() {
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: error => { void expireSession(client, error); } }),
    mutationCache: new MutationCache({ onError: error => { void expireSession(client, error); } }),
    defaultOptions: { queries: { retry: false, staleTime: 3_000 }, mutations: { retry: false } },
  });
  return client;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
