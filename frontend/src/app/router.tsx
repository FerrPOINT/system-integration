import { lazy } from 'react';
import { Navigate, Outlet, useOutletContext, type RouteObject } from 'react-router-dom';
import { App } from './app';
import { RootErrorBoundary, RouteErrorBoundary } from './root-error-boundary';
import type { SessionRouteContext } from './route-context';
import type { TaskRouteContext } from '../features/tasks/ui/task-route-context';
import { PageHeader } from '../shared/ui/page-header';
import { BackLink } from '../shared/ui/back-link';

const TaskList = lazy(() =>
  import('../features/tasks/ui/task-list-page').then((module) => ({ default: module.TaskList })),
);
const TaskCard = lazy(() =>
  import('../features/tasks/ui/task-details-page').then((module) => ({ default: module.TaskCard })),
);
const NewTask = lazy(() =>
  import('../features/tasks/ui/task-create-dialog').then((module) => ({ default: module.NewTask })),
);
const IssueList = lazy(() =>
  import('../features/operations/ui/issue-list-page').then((module) => ({ default: module.IssueList })),
);
const IssueCard = lazy(() =>
  import('../features/operations/ui/issue-details-page').then((module) => ({ default: module.IssueCard })),
);
const ReconciliationCard = lazy(() =>
  import('../features/operations/ui/reconciliation-page').then((module) => ({ default: module.ReconciliationCard })),
);

function TaskListRoute() {
  const { user } = useOutletContext<SessionRouteContext>();
  return <TaskList user={user} />;
}
function TaskDetailsRoute() {
  const { user } = useOutletContext<SessionRouteContext>();
  return <TaskCard user={user} />;
}
function NewTaskRoute() {
  const { user } = useOutletContext<TaskRouteContext>();
  return user.role === 'INITIATOR' ? <NewTask /> : <Navigate to="/tasks" replace />;
}
function OperatorRoutes() {
  const context = useOutletContext<SessionRouteContext>();
  return context.user.role === 'OPERATOR' ? <Outlet context={context} /> : <Navigate to="/tasks" replace />;
}

/** One route tree for production and integration fixtures; Query owns all reads. */
export const appRoutes: RouteObject[] = [
  {
    element: <App />,
    errorElement: <RootErrorBoundary />,
    children: [
      {
        errorElement: <RouteErrorBoundary />,
        children: [
          { index: true, element: <Navigate to="/tasks" replace /> },
          { path: 'tasks', element: <TaskListRoute />, children: [{ path: 'new', element: <NewTaskRoute /> }] },
          { path: 'tasks/:id', element: <TaskDetailsRoute /> },
          {
            element: <OperatorRoutes />,
            children: [
              { path: 'issues', element: <IssueList /> },
              { path: 'issues/:id', element: <IssueCard /> },
              { path: 'tasks/:taskId/reconciliations/:reconciliationId', element: <ReconciliationCard /> },
            ],
          },
          {
            path: '*',
            element: (
              <section>
                <PageHeader title="Страница не найдена" back={<BackLink to="/tasks">К заданиям</BackLink>} />
              </section>
            ),
          },
        ],
      },
    ],
  },
];
