import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { clearSession, csrf, data, keys } from './api';
import { getSession, logIn, logOut } from '../../build/generated/openapi/client';
import type { GetSession200 } from '../../build/generated/openapi/client';
import { ErrorMessage, Loading } from '../ui/Feedback';
import { TaskList, NewTask, TaskCard } from '../features/tasks/Tasks';
import { IssueList, IssueCard, ReconciliationCard } from '../features/operations/Operations';

export function App() {
  const session = useQuery({
    queryKey: keys.session,
    queryFn: async () => {
      const response = await getSession();
      return response.status === 401 ? null : data(Promise.resolve(response));
    },
    staleTime: 0,
  });
  if (session.isPending) return <main><Loading /></main>;
  if (session.isError) return <main><ErrorMessage error={session.error} />
    <button onClick={() => session.refetch()}>Повторить</button></main>;
  if (!session.data) return <Login />;
  return <Shell user={session.data} />;
}

function Login() {
  const client = useQueryClient();
  const login = useMutation({
    mutationFn: async (form: FormData) => {
      await data(logIn({ username: String(form.get('username')), password: String(form.get('password')) }, await csrf()));
      await csrf();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.session }),
  });
  return <main className="login-page">
    <div className="brand">SYSTEM INTEGRATION</div>
    <section className="panel login-panel">
      <h1>Обмен с внешней системой</h1>
      <p className="muted">Войдите, чтобы работать с заданиями и результатами обмена.</p>
      <form onSubmit={event => { event.preventDefault(); login.mutate(new FormData(event.currentTarget)); }}>
        <label>Логин<input name="username" autoComplete="username" required maxLength={64} autoFocus /></label>
        <label>Пароль<input name="password" type="password" autoComplete="current-password" required /></label>
        <ErrorMessage error={login.error} />
        <button className="primary" disabled={login.isPending}>{login.isPending ? 'Входим…' : 'Войти'}</button>
      </form>
    </section>
  </main>;
}

function Shell({ user }: { user: GetSession200 }) {
  const logout = useMutation({
    mutationFn: async () => { await data(logOut(await csrf())); await csrf(); },
    onSuccess: clearSession,
  });
  return <>
    <a className="skip-link" href="#main">К содержимому</a>
    <header className="app-header">
      <Link to="/tasks" className="brand">Обмен с внешней системой</Link>
      <nav aria-label="Основная навигация"><NavLink to="/tasks">Задания</NavLink>
        {user.role === 'OPERATOR' && <NavLink to="/issues">Разбор обмена</NavLink>}</nav>
      <div className="account"><span>{user.username}<small>{user.role === 'OPERATOR' ? 'Оператор' : 'Инициатор'}</small></span>
        <button onClick={() => logout.mutate()} disabled={logout.isPending}>Выйти</button></div>
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
