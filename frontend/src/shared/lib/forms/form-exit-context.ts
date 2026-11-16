import { createContext, type Dispatch, type SetStateAction } from 'react';

/** The active form owns permission for shell actions that unmount its page. */
export type FormExitGuard = { request: (exit: () => void) => void; pending: boolean };
export const FormExitContext = createContext<Dispatch<SetStateAction<FormExitGuard | null>> | null>(null);
