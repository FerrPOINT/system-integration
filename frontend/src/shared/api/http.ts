import type { Problem } from '../../../build/generated/openapi/client';

const messages: Partial<Record<Problem['code'], string>> = {
  INVALID_CREDENTIALS: 'Неверный логин или пароль',
  SERVICE_UNAVAILABLE: 'Сервис временно недоступен. Повторите запрос позже',
  SESSION_REQUIRED: 'Сессия завершена. Войдите снова',
  CSRF_INVALID: 'Защитный токен устарел. Повторите действие',
  ACCESS_DENIED: 'Недостаточно прав для этого действия',
};

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, payload?: unknown) {
    const problem = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const codeMessage = typeof problem.code === 'string' ? messages[problem.code as Problem['code']] : undefined;
    super(
      codeMessage ||
        (typeof problem.detail === 'string' && problem.detail) ||
        (typeof problem.title === 'string' && problem.title) ||
        'Не удалось выполнить запрос',
    );
    this.name = 'ApiError';
    this.status = status;
  }
}

export class ProtocolError extends Error {
  readonly status: number;
  constructor(status: number, cause?: unknown) {
    super('Сервис вернул некорректный ответ. Повторите чтение данных.', { cause });
    this.name = 'ProtocolError';
    this.status = status;
  }
}

type HttpResponse = { status: number; data: unknown };
type Success<T> = Extract<T, { status: 200 | 201 | 204 }>;

/** Orval owns URL/body/header serialization; this boundary owns response decoding. */
export async function http<T>(url: string, options?: RequestInit): Promise<T> {
  // Network failures and AbortError retain their original identity for Query cancellation.
  const response = await fetch(url, options);
  let payload: unknown;
  if (response.status !== 204) {
    try {
      const text = await response.text();
      if (!text.trim()) {
        if (response.ok) throw new ProtocolError(response.status);
      } else {
        payload = JSON.parse(text);
        if (response.ok && payload == null) throw new ProtocolError(response.status);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (response.ok) throw error instanceof ProtocolError ? error : new ProtocolError(response.status, error);
      // HTML, empty and broken error bodies cannot erase the actual HTTP status.
    }
  }
  return { data: payload, status: response.status, headers: response.headers } as T;
}

export async function data<T extends HttpResponse>(request: Promise<T>): Promise<Success<T>['data']> {
  const response = await request;
  if (response.status < 200 || response.status >= 300) throw new ApiError(response.status, response.data);
  return response.data as Success<T>['data'];
}
