import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import type { GetSession200 } from '../../../build/generated/openapi/client';
import { Button } from '../../shared/ui/button';
import { useMediaQuery } from '../../shared/ui/use-media-query';
import { Brand } from './brand';
import { MobileAccountMenu } from './mobile-account-menu';

export function AppHeader({ user, appearance, pending, onLogout }: {
  user: Readonly<GetSession200>; appearance: ReactNode; pending: boolean; onLogout: () => void;
}) {
  const mobile = useMediaQuery('(max-width: 760px)');
  const controls = <>{appearance}<div className="account"><span>{user.username}<small>{user.role === 'OPERATOR' ? 'Оператор' : 'Инициатор'}</small></span>
    <Button onClick={onLogout} disabled={pending}>Выйти</Button></div></>;
  return <header className="app-header">
    <Link to="/tasks" className="brand-link"><Brand /></Link>
    <nav className="main-nav" aria-label="Основная навигация"><NavLink to="/tasks">Задания</NavLink>
      {user.role === 'OPERATOR' && <NavLink to="/issues">Разбор обмена</NavLink>}</nav>
    {mobile ? <MobileAccountMenu>{controls}</MobileAccountMenu> : <div className="header-controls">{controls}</div>}
  </header>;
}
