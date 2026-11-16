import { Notice } from './notice';
import { ApiError, RequestPreconditionError } from '../api/http';

export function ErrorMessage({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <Notice tone="danger" role="alert">
      {error instanceof ApiError || error instanceof RequestPreconditionError
        ? error.message
        : 'Не удалось выполнить запрос. Повторите попытку.'}
    </Notice>
  );
}
