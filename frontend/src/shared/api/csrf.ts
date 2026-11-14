import { getCsrfToken } from '../../../build/generated/openapi/client';
import { data } from './http';

export async function csrf() {
  return { 'X-CSRF-TOKEN': (await data(getCsrfToken())).token };
}
