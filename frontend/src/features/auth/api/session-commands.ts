import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logIn, logOut } from '../../../../build/generated/openapi/client';
import { data, RequestCapabilityError } from '../../../shared/api/http';
import { csrf } from '../../../shared/api/csrf';
import { clearSession, sessionGeneration, sessionKey } from '../model/session-policy';

function changeSession<T>(command: () => Promise<T>) {
  if (!navigator.locks)
    throw new RequestCapabilityError('Для безопасной смены сессии нужен современный браузер и HTTPS или localhost.');
  // Login and logout both change the origin-wide cookie, including in other tabs.
  return navigator.locks.request('system-integration-session-cookie', command);
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) =>
      changeSession(async () =>
        data(logIn({ username: String(form.get('username')), password: String(form.get('password')) }, await csrf())),
      ),
    // Session-query failures have their own recovery in the auth gate.
    onSuccess: () => client.invalidateQueries({ queryKey: sessionKey }),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    onMutate: () => sessionGeneration(client),
    // Each next write obtains its own rotated CSRF token before sending.
    mutationFn: () => changeSession(async () => data(logOut(await csrf()))),
    onSuccess: (_data, _variables, generation) => {
      if (generation === undefined) throw new Error('Не определено поколение команды выхода');
      return clearSession(client, generation);
    },
  });
}
