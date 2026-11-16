import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logIn, logOut } from '../../../../build/generated/openapi/client';
import { data, RequestPreconditionError } from '../../../shared/api/http';
import { sessionGeneration, sessionKey } from '../../../shared/api/session-scope';
import { useSessionCommand } from '../../../shared/api/csrf';
import { clearSession } from '../model/session-policy';

function changeSession<T>(command: () => Promise<T>) {
  if (!navigator.locks)
    throw new RequestPreconditionError('Для безопасной смены сессии нужен современный браузер и HTTPS или localhost.');
  // Login and logout both change the origin-wide cookie, including in other tabs.
  return navigator.locks.request('system-integration-session-cookie', command);
}

export function useLogin() {
  const client = useQueryClient();
  const send = useSessionCommand();
  return useMutation({
    mutationFn: (form: FormData) =>
      changeSession(() =>
        send((headers) =>
          data(logIn({ username: String(form.get('username')), password: String(form.get('password')) }, headers)),
        ),
      ),
    // Session-query failures have their own recovery in the auth gate.
    onSuccess: () => client.invalidateQueries({ queryKey: sessionKey }),
  });
}

export function useLogout() {
  const client = useQueryClient();
  const send = useSessionCommand();
  return useMutation({
    onMutate: () => sessionGeneration(client),
    // Each next write obtains its own rotated CSRF token before sending.
    mutationFn: () => changeSession(() => send((headers) => data(logOut(headers)))),
    onSuccess: (_data, _variables, generation) => {
      if (generation === undefined) throw new Error('Не определено поколение команды выхода');
      return clearSession(client, generation);
    },
  });
}
