import { Button } from './button';
import { Notice } from './notice';

/** A receipt is already accepted. Recovery here repeats only the affected reads. */
export function CommandRefresh({
  message,
  error,
  pending,
  onRetry,
}: {
  message: string;
  error: Error | null;
  pending: boolean;
  onRetry: () => void;
}) {
  if (!error && !pending) return null;
  return (
    <Notice tone={error ? 'warning' : 'info'} role={error ? 'alert' : 'status'}>
      <p>
        {message} {error ? 'Не удалось обновить данные.' : 'Обновляем данные…'}
      </p>
      {error && (
        <Button type="button" onClick={onRetry}>
          Повторить обновление
        </Button>
      )}
    </Notice>
  );
}
