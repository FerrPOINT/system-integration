import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { appRoutes } from '../src/app/router';
import { createQueryClient } from '../src/app/providers';
import type { CollectionPage } from '../src/shared/lib/collections/project-collection';
import type { InfiniteData } from '@tanstack/react-query';
import '../src/shared/styles/design-tokens.css';
import '../src/shared/styles/controls.css';
import '../src/shared/styles/patterns.css';
import '../src/shared/styles/layout.css';
import '../src/app/shell/shell.css';

const client = createQueryClient();
const history = new URLSearchParams(location.search).has('history');
const list = (query: { queryKey: readonly unknown[] }) =>
  query.queryKey[0] === 'tasks' && (history ? query.queryKey[2] === 'history' : query.queryKey[1] === 'list');
Object.assign(window, {
  fixtureCollectionInfo() {
    const query = client.getQueryCache().findAll({ predicate: list })[0];
    const data = query?.state.data as InfiniteData<CollectionPage<unknown>> | undefined;
    return {
      pages: data?.pages.map((page) => page.page) ?? [],
      cached: data?.pages.reduce((sum, page) => sum + page.items.length, 0) ?? 0,
      fetching: query?.state.fetchStatus === 'fetching',
    };
  },
  fixtureEvictInactiveLists() {
    client.removeQueries({ predicate: (query) => list(query) && query.getObserversCount() === 0 });
  },
});
const router = createBrowserRouter(appRoutes);
// Use the actual browser address so transition/position guards run as in production.
await router.navigate(history ? '/tasks/10000000-0000-4000-8000-000001000000' : '/tasks', { replace: true });
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
