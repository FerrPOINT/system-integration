import { useRef } from 'react';

export function useCommandKey() {
  const command = useRef<{ body: string; key: string } | null>(null);
  return {
    forInput(input: unknown) {
      const body = JSON.stringify(input);
      if (command.current?.body !== body) command.current = { body, key: crypto.randomUUID() };
      return command.current.key;
    },
    reset() { command.current = null; },
  };
}
