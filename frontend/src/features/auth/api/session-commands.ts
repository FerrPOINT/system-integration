import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logIn, logOut } from '../../../../build/generated/openapi/client';
import { data } from '../../../shared/api/http';
import { csrf } from '../../../shared/api/csrf';
import { clearSession, sessionKey } from '../model/session-policy';

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (form: FormData) =>
      data(logIn({ username: String(form.get('username')), password: String(form.get('password')) }, await csrf())),
    // Session-query failures have their own recovery in the auth gate.
    onSuccess: () => client.invalidateQueries({ queryKey: sessionKey }),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    // Each next write obtains its own rotated CSRF token before sending.
    mutationFn: async () => data(logOut(await csrf())),
    onSuccess: () => clearSession(client),
  });
}
