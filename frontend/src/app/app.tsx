import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './shell/app-shell';
import { Brand } from './shell/brand';
import { ThemePicker, useThemePreference } from './shell/theme';
import { sessionOptions } from '../features/auth/api/session-queries';
import { LoginForm } from '../features/auth/ui/login-form';
import { ErrorMessage } from '../shared/ui/error-message';
import { Button } from '../shared/ui/button';
import { Loading } from '../shared/ui/feedback';
import { PageHeader } from '../shared/ui/page-header';
import { BackLink } from '../shared/ui/back-link';
import { TaskList } from '../features/tasks/task-list';
import { NewTask } from '../features/tasks/task-create';
import { TaskCard } from '../features/tasks/task-details';
import { IssueList } from '../features/operations/issue-list';
import { IssueCard } from '../features/operations/issue-details';
import { ReconciliationCard } from '../features/operations/reconciliation-details';

export function App() {
  const appearance = <ThemePicker {...useThemePreference()} />;
  const session = useQuery(sessionOptions);
  if (session.isPending) return <main className="base-page-stack"><Loading /></main>;
  if (session.isError) return <main className="base-page-stack"><ErrorMessage error={session.error} />
    <Button onClick={() => session.refetch()}>Повторить</Button></main>;
  if (!session.data) return <LoginForm brand={<Brand />} appearance={appearance} />;
  const user = session.data;
  return <AppShell key={user.userId + ':' + user.role} user={user} appearance={appearance}>
      <Routes>
        <Route path="/tasks" element={<TaskList user={user} />}>
          <Route path="new" element={user.role === 'INITIATOR' ? <NewTask /> : <Navigate to="/tasks" replace />} />
        </Route>
        <Route path="/tasks/:id" element={<TaskCard user={user} />} />
        <Route path="/issues" element={user.role === 'OPERATOR' ? <IssueList /> : <Navigate to="/tasks" replace />} />
        <Route path="/issues/:id" element={user.role === 'OPERATOR' ? <IssueCard /> : <Navigate to="/tasks" replace />} />
        <Route path="/tasks/:taskId/reconciliations/:reconciliationId" element={user.role === 'OPERATOR' ? <ReconciliationCard /> : <Navigate to="/tasks" replace />} />
        <Route path="/" element={<Navigate to="/tasks" replace />} />
        <Route path="*" element={<section><PageHeader title="Страница не найдена" back={<BackLink to="/tasks">К заданиям</BackLink>} /></section>} />
      </Routes>
  </AppShell>;
}
