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

test('the real TS import graph rejects cycles', async () => {
  const results = await eslint.lintFiles(['architecture-fixtures/cycle-a.ts', 'architecture-fixtures/cycle-b.ts']);
  assert.ok(results.every(result => result.messages.some(message => message.ruleId === 'import-x/no-cycle')),
    JSON.stringify(results.map(result => result.messages)));
});

test('layer boundaries reject lower-to-app imports while valid shared/type imports pass', async () => {
  const invalid = (await eslint.lintText("import { createQueryClient } from '../app/providers'; export const invalid = createQueryClient;", { filePath: 'src/shared/layer-probe.ts' }))[0];
  assert.ok(invalid.messages.some(message => message.ruleId === 'import-x/no-restricted-paths'), JSON.stringify(invalid.messages));
  const valid = (await eslint.lintText("import type { Task } from '../../build/generated/openapi/client'; import { data } from './api/http'; export const valid = (task:Task) => task.taskId; export const read = data;", { filePath: 'src/shared/layer-probe.ts' }))[0];
  assert.deepEqual(valid.messages, []);
});

test('a dynamic generated client import cannot bypass the screen API boundary', async () => {
  const invalid = (await eslint.lintText("export const invalid = () => import('../../../../build/generated/openapi/client');", { filePath: 'src/features/tasks/ui/layer-probe.ts' }))[0];
  assert.ok(invalid.messages.some(message => message.ruleId === 'no-restricted-syntax'), JSON.stringify(invalid.messages));
});

test('cross-feature imports use only the declared public contracts', async () => {
  const forbidden = (await eslint.lintText("import { IssueCard } from '../../operations/ui/issue-details-page'; export const invalid = IssueCard;", { filePath: 'src/features/tasks/ui/layer-probe.ts' }))[0];
  assert.ok(forbidden.messages.some(message => message.ruleId === 'import-x/no-restricted-paths'), JSON.stringify(forbidden.messages));
  const permitted = (await eslint.lintText("import { ReconcileButton } from '../../operations/reconciliation'; export const valid = ReconcileButton;", { filePath: 'src/features/tasks/ui/layer-probe.ts' }))[0];
  assert.deepEqual(permitted.messages, []);
});

test('feature-to-app and dynamic lower-to-app imports are also rejected', async () => {
  for (const [source, filePath] of [
    ["import { createQueryClient } from '../../../app/providers'; export const invalid = createQueryClient;", 'src/features/tasks/ui/layer-probe.ts'],
    ["export const invalid = () => import('../app/providers');", 'src/shared/layer-probe.ts'],
  ]) {
    const result = (await eslint.lintText(source, { filePath }))[0];
    assert.ok(result.messages.some(message => message.ruleId === 'import-x/no-restricted-paths'), JSON.stringify(result.messages));
  }
});

test('screen requests use the feature API while DTO-only imports remain valid', async () => {
  const invalid = (await eslint.lintText("import { getTask } from '../../../../build/generated/openapi/client'; export const invalid = getTask;", { filePath: 'src/features/tasks/ui/layer-probe.ts' }))[0];
  assert.ok(invalid.messages.some(message => message.ruleId === 'no-restricted-imports'), JSON.stringify(invalid.messages));
  const valid = (await eslint.lintText("import type { Task } from '../../../../build/generated/openapi/client'; export const valid = (task:Task) => task.taskId;", { filePath: 'src/features/tasks/ui/layer-probe.ts' }))[0];
  assert.deepEqual(valid.messages, []);
});

test('the URL parser enum exception does not permit generated requests', async () => {
  const filePath = 'src/features/tasks/model/task-search.ts';
  const valid = (await eslint.lintText("import { BusinessStatus } from '../../../../build/generated/openapi/client'; export const valid = BusinessStatus;", { filePath }))[0];
  assert.deepEqual(valid.messages, []);
  const invalid = (await eslint.lintText("import { getTask } from '../../../../build/generated/openapi/client'; export const invalid = getTask;", { filePath }))[0];
  assert.ok(invalid.messages.some(message => message.ruleId === 'no-restricted-imports'), JSON.stringify(invalid.messages));
});
