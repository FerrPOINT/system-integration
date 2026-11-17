import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from 'react-router-dom';
import { AppShell } from './shell/app-shell';
import { AppHeader } from './shell/app-header';
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
  const navigate = useNavigate();
  if (!session.data)
    return (
      <div className="app-shell">
        <AppHeader appearance={appearance} />
        <main className="login-page" id="main">
          {session.isPending ? (
            <Loading />
          ) : session.isError ? (
            <div className="ui-page-stack">
              <ErrorMessage error={session.error} />
              <Button onClick={() => session.refetch()}>Повторить</Button>
            </div>
          ) : (
            <LoginForm onAuthenticated={() => navigate('/', { replace: true, flushSync: true })} />
          )}
        </main>
      </div>
    );
  const user = session.data;
  return (
    <AppShell key={user.userId + ':' + user.role} user={user} appearance={appearance}>
      {session.isError && (
        <div className="ui-page-stack">
          <ErrorMessage error={session.error} />
          <Button onClick={() => session.refetch()} disabled={session.isFetching}>
            Повторить проверку сессии
          </Button>
        </div>
      )}
      <Outlet context={{ user } satisfies SessionRouteContext} />
    </AppShell>
  );
}
