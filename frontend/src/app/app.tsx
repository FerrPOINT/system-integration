import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';
import { Suspense } from 'react';
import { AppShell } from './shell/app-shell';
import { Brand } from './shell/brand';
import { ThemePicker, useThemePreference } from './shell/theme';
import { sessionOptions } from '../features/auth/api/session-queries';
import { LoginForm } from '../features/auth/ui/login-form';
import { ErrorMessage } from '../shared/ui/error-message';
import { Button } from '../shared/ui/button';
import { Loading } from '../shared/ui/feedback';
import type { SessionRouteContext } from './route-context';

export function App() {
  const appearance = <ThemePicker {...useThemePreference()} />;
  const session = useQuery(sessionOptions);
  if (session.isPending) return <main className="base-page-stack"><Loading /></main>;
  if (session.isError) return <main className="base-page-stack"><ErrorMessage error={session.error} />
    <Button onClick={() => session.refetch()}>Повторить</Button></main>;
  if (!session.data) return <LoginForm brand={<Brand />} appearance={appearance} />;
  const user = session.data;
  return <AppShell key={user.userId + ':' + user.role} user={user} appearance={appearance}>
    <Suspense fallback={<Loading />}><Outlet context={{ user } satisfies SessionRouteContext} /></Suspense>
  </AppShell>;
}
