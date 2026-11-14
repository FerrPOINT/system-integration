import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { App } from '../src/app/app';
import { createQueryClient } from '../src/app/providers';
import { RootErrorBoundary } from '../src/app/root-error-boundary';
import '../src/shared/styles/design-tokens.css';
import '../src/shared/styles/controls.css';
import '../src/shared/styles/patterns.css';
import '../src/app/shell/shell.css';

const taskId = '00000000-0000-4000-8000-000000000001';
const queryClient = createQueryClient();
const screen = new URLSearchParams(location.search).get('screen');
const initial = screen === 'list' ? '/tasks?size=10' : screen === 'issue' ? '/issues/' + taskId : '/tasks/' + taskId + '?size=10';
const router = createMemoryRouter([{ path: '*', element: <App />, errorElement: <RootErrorBoundary /> }], { initialEntries: [initial] });
// Security assertion only: expose keys, never credentials or private payloads.
Object.assign(window, { fixturePrivateKeyCount: () => queryClient.getQueryCache().getAll().filter(query => query.queryKey[0] !== 'session').length });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
