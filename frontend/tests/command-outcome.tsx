import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { appRoutes } from '../src/app/router';
import { createQueryClient } from '../src/app/providers';
import '../src/shared/styles/design-tokens.css';
import '../src/shared/styles/controls.css';
import '../src/shared/styles/patterns.css';
import '../src/shared/styles/layout.css';
import '../src/app/shell/shell.css';

const taskId = '00000000-0000-4000-8000-000000000001';
const queryClient = createQueryClient();
const screen = new URLSearchParams(location.search).get('screen');
const initial = screen === 'list' ? '/tasks?size=10' : screen === 'issue' ? '/issues/' + taskId :
  screen === 'new' ? '/tasks/new?size=10' : screen === 'missing' ? '/missing' : '/tasks/' + taskId + '?size=10';
const router = createMemoryRouter(appRoutes, { initialEntries: [initial] });
// Security assertion only: expose keys, never credentials or private payloads.
Object.assign(window, { fixturePrivateKeyCount: () => queryClient.getQueryCache().getAll().filter(query => query.queryKey[0] !== 'session').length });
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></StrictMode>);
