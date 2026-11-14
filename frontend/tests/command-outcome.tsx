import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { App } from '../src/app/App';
import { queryClient } from '../src/app/api';
import { RootErrorBoundary } from '../src/app/root-error-boundary';
import '../src/ui/design-tokens.css';
import '../src/ui/controls.css';
import '../src/ui/patterns.css';
import '../src/app/styles.css';

const taskId = '00000000-0000-4000-8000-000000000001';
const screen = new URLSearchParams(location.search).get('screen');
const initial = screen === 'list' ? '/tasks?size=10' : screen === 'issue' ? '/issues/' + taskId : '/tasks/' + taskId + '?size=10';
const router = createMemoryRouter([{ path: '*', element: <App />, errorElement: <RootErrorBoundary /> }], { initialEntries: [initial] });
// Security assertion only: expose keys, never credentials or private payloads.
Object.assign(window, { fixturePrivateKeyCount: () => queryClient.getQueryCache().getAll().filter(query => query.queryKey[0] !== 'session').length });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
