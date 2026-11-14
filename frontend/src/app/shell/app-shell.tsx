import type { ReactNode } from 'react';
import type { GetSession200 } from '../../../build/generated/openapi/client';
import { useLogout } from '../../features/auth/api/session-commands';
import { ErrorMessage } from '../../shared/ui/error-message';
import { AppHeader } from './app-header';
import { ScrollRestoration } from 'react-router-dom';
import { CollectionOwner } from '../../shared/lib/collections/collection-owner';

export function AppShell({ user, appearance, children }: {
  user: Readonly<GetSession200>; appearance: ReactNode; children: ReactNode;
}) {
  const logout = useLogout();
  const owner = user.userId + ':' + user.role;
  return <CollectionOwner value={owner}><div className="app-shell">
    <a className="skip-link" href="#main">К содержимому</a>
    <AppHeader user={user} appearance={appearance} pending={logout.isPending} onLogout={() => logout.mutate()} />
    <main id="main" className="base-page-stack" tabIndex={-1}>
      <ErrorMessage error={logout.error} />
      {children}
    </main>
  </div><ScrollRestoration getKey={location => owner + ':' +
    (['/tasks', '/issues'].includes(location.pathname) ? location.pathname + location.search : location.key)} /></CollectionOwner>;
}
