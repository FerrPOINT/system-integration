import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint();
const lint = async source => (await eslint.lintText(source, { filePath: 'src/toolchain-probe.tsx' }))[0].messages;

test('TSX/type-only imports parse without a compiler version warning', async () => {
  const messages = await lint("import type { ReactNode } from 'react'; export function Valid({text}:{text:string}):ReactNode { return <p>{text}</p>; }");
  assert.deepEqual(messages, []);
});

test('Rules of Hooks reject a conditional hook in TSX', async () => {
  const messages = await lint("import { useState } from 'react'; export function Invalid({enabled}:{enabled:boolean}) { if(enabled) useState(0); return <p />; }");
  assert.ok(messages.some(message => message.ruleId === 'react-hooks/rules-of-hooks'));
});

test('Query rules reject an unstable client and a missing query-key dependency', async () => {
  const messages = await lint("import { QueryClient, useQuery } from '@tanstack/react-query'; export function Invalid({id}:{id:string}) { const client = new QueryClient(); const query = useQuery({queryKey:['tasks'],queryFn:()=>fetch('/api/tasks/'+id)}); return <p />; }");
  assert.ok(messages.some(message => message.ruleId === '@tanstack/query/stable-query-client'));
  assert.ok(messages.some(message => message.ruleId === '@tanstack/query/exhaustive-deps'));
});
