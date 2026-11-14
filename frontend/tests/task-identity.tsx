import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, useNavigate } from 'react-router-dom';
import { TaskCard } from '../src/features/tasks/ui/task-details-page';
import { taskKeys } from '../src/features/tasks/api/task-keys';
import type { Task } from '../build/generated/openapi/client';
import '../src/shared/styles/design-tokens.css';
import '../src/shared/styles/controls.css';
import '../src/shared/styles/patterns.css';
import '../src/shared/styles/layout.css';
import '../src/app/shell/shell.css';

const params = new URLSearchParams(location.search);
const tasks: Task[] = ['a', 'b'].map((suffix, index) => ({
  taskId: '00000000-0000-4000-8000-00000000000' + (index + 1),
  operationId: '00000000-0000-4000-8000-00000000000' + (index + 1),
  ownerId: '00000000-0000-4000-8000-000000000003',
  title: 'Task ' + suffix.toUpperCase(), titleRevision: index && !params.has('equal') ? 7 : 1,
  request: { reference: 'REQ-00000' + (index + 1), quantity: 25 },
  createdAt: '2026-11-14T00:00:00Z', deliveryStatus: 'ACKNOWLEDGED', businessStatus: 'SUCCEEDED',
}));
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
client.setQueryData(taskKeys.task(tasks[0].taskId), tasks[0]);
if (!params.has('cold')) client.setQueryData(taskKeys.task(tasks[1].taskId), tasks[1]);

function Harness() {
  const navigate = useNavigate();
  return <main className="base-page-stack">
    <nav>
      <button onClick={() => navigate('/tasks/' + tasks[0].taskId)}>Open A</button>
      <button onClick={() => navigate('/tasks/' + tasks[1].taskId)}>Open B</button>
      <button onClick={() => navigate(-1)}>History back</button>
      <button onClick={() => navigate('?page=1&size=10')}>Change history page</button>
      <button onClick={() => client.setQueryData(taskKeys.task(tasks[0].taskId), { ...tasks[0], title: 'Server A', titleRevision: 9 })}>Refresh A</button>
    </nav>
    <TaskCard user={{ userId: tasks[0].ownerId, username: 'fixture', role: 'INITIATOR' }} />
  </main>;
}
const router = createMemoryRouter([{ path: '/tasks/:id', element: <Harness /> }], { initialEntries: ['/tasks/' + tasks[0].taskId] });
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></StrictMode>);
