import './auth.css';
import type { ReactNode } from 'react';
import { useLogin } from '../api/session-commands';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { Card, CardContent } from '../../../shared/ui/card';
import { PageHeader } from '../../../shared/ui/page-header';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Button } from '../../../shared/ui/button';

export function LoginForm({ appearance, brand }: { appearance: ReactNode; brand: ReactNode }) {
  const login = useLogin();
  return <main className="login-page">
    <div className="login-toolbar">{brand}{appearance}</div>
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
