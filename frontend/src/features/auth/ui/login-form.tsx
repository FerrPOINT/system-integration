import './auth.css';
import { usernameInputProps } from '../../../shared/lib/form-rules';
import { useLogin } from '../api/session-commands';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { Card, CardContent } from '../../../shared/ui/card';
import { PageHeader } from '../../../shared/ui/page-header';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Button } from '../../../shared/ui/button';

export function LoginForm() {
  const login = useLogin();
  return (
    <Card asChild>
      <section className="login-panel">
        <CardContent className="ui-page-stack">
          <PageHeader title="Вход в систему" context="Введите логин и пароль вашей учётной записи." />
          <form
            className="ui-form"
            onSubmit={(event) => {
              event.preventDefault();
              login.mutate(new FormData(event.currentTarget));
            }}
          >
            <FormField id="field-username" label="Логин" required>
              {(attrs) => (
                <Input {...attrs} name="username" autoComplete="username" {...usernameInputProps} autoFocus />
              )}
            </FormField>
            <FormField id="field-password" label="Пароль" required>
              {(attrs) => <Input {...attrs} name="password" type="password" autoComplete="current-password" />}
            </FormField>
            <ErrorMessage error={login.error} />
            <Button variant="default" disabled={login.isPending}>
              {login.isPending ? 'Входим…' : 'Войти'}
            </Button>
          </form>
        </CardContent>
      </section>
    </Card>
  );
}
