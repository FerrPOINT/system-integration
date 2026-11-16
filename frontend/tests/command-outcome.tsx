import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { appRoutes } from '../src/app/router';
import { createQueryClient } from '../src/app/providers';
import { CommandProbe } from './command-probe';
import '../src/shared/styles/design-tokens.css';
import '../src/shared/styles/controls.css';
import '../src/shared/styles/patterns.css';
import '../src/shared/styles/layout.css';
import '../src/app/shell/shell.css';

const taskId = '00000000-0000-4000-8000-000000000001';
const queryClient = createQueryClient();
let failedCommands = 0;
let successfulCommands = 0;
queryClient.getMutationCache().subscribe((event) => {
  if (event.type === 'updated' && event.action.type === 'error') failedCommands++;
  if (event.type === 'updated' && event.action.type === 'success') successfulCommands++;
});
const screen = new URLSearchParams(location.search).get('screen');
const initial =
  screen === 'probe'
    ? '/probe'
    : screen === 'list'
      ? '/tasks?size=10'
      : screen === 'issues'
        ? '/issues?status=RESOLVED&page=999&size=10'
        : screen === 'issue'
          ? '/issues/' + taskId
          : screen === 'reconciliation'
            ? '/tasks/' + taskId + '/reconciliations/00000000-0000-4000-8000-000000000010'
            : screen === 'new'
              ? '/tasks/new?size=10'
              : screen === 'missing'
                ? '/missing'
                : '/tasks/' + taskId + '?size=10';
const routes: RouteObject[] = [
  {
    ...appRoutes[0],
    index: false,
    children: [...(appRoutes[0].children ?? []), { path: 'probe', element: <CommandProbe /> }],
  },
];
const router = createMemoryRouter(routes, { initialEntries: ['/tasks', initial] });
// Fixture navigation/lifecycle controls expose no credentials or private payloads.
Object.assign(window, {
  fixtureBack: () => {
    void router.navigate(-1);
  },
  fixturePrivateKeyCount: () =>
    queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[0] !== 'session').length,
  fixtureRefetchSession: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
  fixtureFailedCommands: () => failedCommands,
  fixtureSuccessfulCommands: () => successfulCommands,
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
