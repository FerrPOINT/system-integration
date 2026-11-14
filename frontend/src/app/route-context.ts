import type { GetSession200 } from '../../build/generated/openapi/client';

/** The auth gate forwards the query's immutable value, not another session store. */
export type SessionRouteContext = { user: Readonly<GetSession200> };
