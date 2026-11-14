import { createContext } from 'react';

/** Navigation metadata is scoped to the authenticated identity, never to a DTO cache. */
export const CollectionOwner = createContext<string | null>(null);
