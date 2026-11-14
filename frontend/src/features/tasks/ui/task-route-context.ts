import type { RefObject } from 'react';
import type { GetSession200 } from '../../../../build/generated/openapi/client';

export type TaskRouteContext = { user: Readonly<GetSession200>; createTrigger: RefObject<HTMLAnchorElement | null> };
