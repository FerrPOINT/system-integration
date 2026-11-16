import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import type { GetSession200 } from '../../../build/generated/openapi/client';
import { Button } from '../../shared/ui/button';
import { useMediaQuery } from '../../shared/ui/use-media-query';
import { Brand } from './brand';
import { MobileAccountMenu } from './mobile-account-menu';

export function AppHeader({
  appearance,
  account,
}: {
  appearance: ReactNode;
  account?: { user: Readonly<GetSession200>; pending: boolean; onLogout: () => void; error: Error | null };
}) {
  const mobile = useMediaQuery('(max-width: 760px)');
  const controls = (
    <>
      {appearance}
      {account && (
        <div className="account">
          <span>
            {account.user.username}
            <small>{account.user.role === 'OPERATOR' ? 'Оператор' : 'Инициатор'}</small>
          </span>
          <Button onClick={account.onLogout} disabled={account.pending}>
            Выйти
          </Button>
        </div>
      )}
    </>
  );
  return (
    <header className="app-header">
      <Link to="/tasks" className="brand-link">
        <Brand />
      </Link>
      {account && (
        <nav className="main-nav" aria-label="Основная навигация">
          <NavLink to="/tasks">Задания</NavLink>
          {account.user.role === 'OPERATOR' && <NavLink to="/issues">Разбор обмена</NavLink>}
        </nav>
      )}
      {mobile && account ? (
        <MobileAccountMenu error={account.error}>{controls}</MobileAccountMenu>
      ) : (
        <div className="header-controls">{controls}</div>
      )}
    </header>
  );
}
