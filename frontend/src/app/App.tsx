import { ErrorMessage } from './error-message';
import { PageHeader } from '../ui/page-header';
import { BackLink } from '../ui/back-link';
import { Card, CardContent } from '../ui/card';
import { FormField } from '../ui/form-field';
import { Brand } from './Brand';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { useRef, useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { Dialog } from '../ui/dialog';
import { useMediaQuery } from '../ui/use-media-query';
import { ThemePicker, useThemePreference } from './theme';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { clearSession, readSession, csrf, data, keys } from './api';
import { logIn, logOut } from '../../build/generated/openapi/client';
import type { GetSession200 } from '../../build/generated/openapi/client';
import { Loading } from '../ui/Feedback';
import { TaskList } from '../features/tasks/task-list';
import { NewTask } from '../features/tasks/task-create';
import { TaskCard } from '../features/tasks/task-details';
import { IssueList } from '../features/operations/issue-list';
import { IssueCard } from '../features/operations/issue-details';
import { ReconciliationCard } from '../features/operations/reconciliation-details';

export function App() {
  const appearance = <ThemePicker {...useThemePreference()} />;
  const session = useQuery({
    queryKey: keys.session,
    queryFn: readSession,
    staleTime: 0,
  });
  if (session.isPending) return <main className="base-page-stack"><Loading /></main>;
  if (session.isError) return <main className="base-page-stack"><ErrorMessage error={session.error} />
    <Button onClick={() => session.refetch()}>Повторить</Button></main>;
  if (!session.data) return <Login appearance={appearance} />;
  return <Shell key={session.data.userId + ':' + session.data.role} user={session.data} appearance={appearance} />;
}

function Login({ appearance }: { appearance: ReactNode }) {
  const client = useQueryClient();
  const login = useMutation({
    mutationFn: async (form: FormData) => {
      await data(logIn({ username: String(form.get('username')), password: String(form.get('password')) }, await csrf()));
      await csrf();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.session }),
  });
  return <main className="login-page">
    <div className="login-toolbar"><Brand />{appearance}</div>
    <div className="login-content">
    <Card asChild><section className="login-panel"><CardContent className="base-page-stack">
      <PageHeader title="Вход в систему" context="Введите логин и пароль вашей учётной записи." />
      <form className="base-form" onSubmit={event => { event.preventDefault(); login.mutate(new FormData(event.currentTarget)); }}>
        <FormField id="field-username" label="Логин" required>{attrs => <Input {...attrs} name="username" autoComplete="username" maxLength={64} autoFocus />}</FormField>
        <FormField id="field-password" label="Пароль" required>{attrs => <Input {...attrs} name="password" type="password" autoComplete="current-password" />}</FormField>
        <ErrorMessage error={login.error} />
        <Button variant="default" disabled={login.isPending}>{login.isPending ? 'Входим…' : 'Войти'}</Button>
      </form>
    </CardContent></section></Card>
    </div>
  </main>;
}

function Shell({ user, appearance }: { user: GetSession200; appearance: ReactNode }) {
  const mobile = useMediaQuery('(max-width: 760px)');
  const logout = useMutation({
    mutationFn: async () => { await data(logOut(await csrf())); await csrf(); },
    onSuccess: clearSession,
  });
  const controls = <>{appearance}<div className="account"><span>{user.username}<small>{user.role === 'OPERATOR' ? 'Оператор' : 'Инициатор'}</small></span>
    <Button onClick={() => logout.mutate()} disabled={logout.isPending}>Выйти</Button></div></>;
  return <div className="app-shell">
    <a className="skip-link" href="#main">К содержимому</a>
    <header className="app-header">
      <Link to="/tasks" className="brand-link"><Brand /></Link>
      <nav className="main-nav" aria-label="Основная навигация"><NavLink to="/tasks">Задания</NavLink>
        {user.role === 'OPERATOR' && <NavLink to="/issues">Разбор обмена</NavLink>}</nav>
      {mobile ? <MobileAccountMenu>{controls}</MobileAccountMenu> : <div className="header-controls">{controls}</div>}
    </header>
    <main id="main" className="base-page-stack" tabIndex={-1}>
      <ErrorMessage error={logout.error} />
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
    </main>
  </div>;
}

function MobileAccountMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={trigger} className="base-icon-button mobile-account-trigger" aria-label="Меню приложения" title="Меню приложения"
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={22} aria-hidden="true" /></Button>
    <Dialog open={open} title="Меню приложения" description="Тема и учётная запись." onClose={() => setOpen(false)} returnFocusRef={trigger}>
      <div className="base-dialog-body mobile-account-menu">{children}</div>
    </Dialog>
  </>;
}
