import type { ReactNode } from 'react';
import { ThemePicker, useThemePreference } from './theme';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { clearSession, csrf, data, keys } from './api';
import { getSession, logIn, logOut } from '../../build/generated/openapi/client';
import type { GetSession200 } from '../../build/generated/openapi/client';
import { ErrorMessage, Loading } from '../ui/Feedback';
import { TaskList, NewTask, TaskCard } from '../features/tasks/Tasks';
import { IssueList, IssueCard, ReconciliationCard } from '../features/operations/Operations';

export function App() {
  const appearance = <ThemePicker {...useThemePreference()} />;
  const session = useQuery({
    queryKey: keys.session,
    queryFn: () => data(getSession()),
    staleTime: 0,
  });
  if (session.isPending) return <main><Loading /></main>;
  if (session.isError) return <main><ErrorMessage error={session.error} />
    <button onClick={() => session.refetch()}>Повторить</button></main>;
  if (!session.data) return <Login appearance={appearance} />;
  return <Shell user={session.data} appearance={appearance} />;
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
    <div className="login-toolbar"><span className="brand"><span className="brand-mark" aria-hidden="true">↔</span> Сервис обмена</span>{appearance}</div>
    <section className="login-intro"><p className="eyebrow">Задания и результаты</p>
      <h1>Обмен с внешней системой</h1>
      <p className="login-description">Создавайте задания, следите за исполнением и разбирайте расхождения в одном месте.</p>
      <ol className="workflow-steps" aria-label="Как проходит задание">
        <li><strong>Создание</strong><span>Задание сохраняется и попадает в очередь.</span></li>
        <li><strong>Исполнение</strong><span>Получение и результат показаны отдельно.</span></li>
        <li><strong>Проверка</strong><span>История и сверка помогают разобраться в итоге.</span></li>
      </ol>
    </section>
    <section className="panel login-panel">
      <h2>Вход в систему</h2>
      <p className="muted">Введите логин и пароль вашей учётной записи.</p>
      <form onSubmit={event => { event.preventDefault(); login.mutate(new FormData(event.currentTarget)); }}>
        <label>Логин<input name="username" autoComplete="username" required maxLength={64} autoFocus /></label>
        <label>Пароль<input name="password" type="password" autoComplete="current-password" required /></label>
        <ErrorMessage error={login.error} />
        <button className="primary" disabled={login.isPending}>{login.isPending ? 'Входим…' : 'Войти'}</button>
      </form>
    </section>
  </main>;
}

function Shell({ user, appearance }: { user: GetSession200; appearance: ReactNode }) {
  const logout = useMutation({
    mutationFn: async () => { await data(logOut(await csrf())); await csrf(); },
    onSuccess: clearSession,
  });
  return <>
    <a className="skip-link" href="#main">К содержимому</a>
    <header className="app-header">
      <Link to="/tasks" className="brand"><span className="brand-mark" aria-hidden="true">↔</span><span>Обмен с внешней системой</span></Link>
      <nav className="main-nav" aria-label="Основная навигация"><NavLink to="/tasks">Задания</NavLink>
        {user.role === 'OPERATOR' && <NavLink to="/issues">Разбор обмена</NavLink>}</nav>
      <div className="header-controls">{appearance}<div className="account"><span>{user.username}<small>{user.role === 'OPERATOR' ? 'Оператор' : 'Инициатор'}</small></span>
        <button onClick={() => logout.mutate()} disabled={logout.isPending}>Выйти</button></div></div>
    </header>
    <main id="main" tabIndex={-1}>
      <ErrorMessage error={logout.error} />
      <Routes>
        <Route path="/tasks" element={<TaskList user={user} />} />
        <Route path="/tasks/new" element={user.role === 'INITIATOR' ? <NewTask /> : <Navigate to="/tasks" replace />} />
        <Route path="/tasks/:id" element={<TaskCard user={user} />} />
        <Route path="/issues" element={user.role === 'OPERATOR' ? <IssueList /> : <Navigate to="/tasks" replace />} />
        <Route path="/issues/:id" element={user.role === 'OPERATOR' ? <IssueCard /> : <Navigate to="/tasks" replace />} />
        <Route path="/tasks/:taskId/reconciliations/:reconciliationId" element={user.role === 'OPERATOR' ? <ReconciliationCard /> : <Navigate to="/tasks" replace />} />
        <Route path="/" element={<Navigate to="/tasks" replace />} />
        <Route path="*" element={<section><h1>Страница не найдена</h1><Link to="/tasks">К заданиям</Link></section>} />
      </Routes>
    </main>
  </>;
}
