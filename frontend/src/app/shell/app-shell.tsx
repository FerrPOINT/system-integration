import { useState, type ReactNode } from 'react';
import type { GetSession200 } from '../../../build/generated/openapi/client';
import { useLogout } from '../../features/auth/api/session-commands';
import { ErrorMessage } from '../../shared/ui/error-message';
import { AppHeader } from './app-header';
import { ScrollRestoration } from 'react-router-dom';
import { CollectionOwner } from '../../shared/lib/collections/collection-owner';
import { useMainScroll } from './use-main-scroll';
import { FormExitContext, type FormExitGuard } from '../../shared/lib/forms/form-exit-context';

export function AppShell({
  user,
  appearance,
  children,
}: {
  user: Readonly<GetSession200>;
  appearance: ReactNode;
  children: ReactNode;
}) {
  const logout = useLogout();
  const [exitGuard, setExitGuard] = useState<FormExitGuard | null>(null);
  const requestLogout = () => {
    const exit = () => logout.mutate();
    if (exitGuard) exitGuard.request(exit);
    else exit();
  };
  const mainScroll = useMainScroll();
  const owner = user.userId + ':' + user.role;
  return (
    <FormExitContext value={setExitGuard}>
      <CollectionOwner value={owner}>
        <div className="app-shell">
          <a className="skip-link" href="#main">
            К содержимому
          </a>
          <AppHeader
            appearance={appearance}
            account={{
              user,
              pending: logout.isPending || Boolean(exitGuard?.pending),
              onLogout: requestLogout,
              error: logout.error,
            }}
          />
          <main {...mainScroll} id="main" className="ui-page-stack" tabIndex={-1}>
            <ErrorMessage error={logout.error} />
            {children}
          </main>
        </div>
        <ScrollRestoration
          getKey={(location) =>
            owner +
            ':' +
            (['/tasks', '/issues'].includes(location.pathname) ? location.pathname + location.search : location.key)
          }
        />
      </CollectionOwner>
    </FormExitContext>
  );
}
