import { ApiFailure, parallel } from '../support/http.mjs';

const reject = code => { throw new ApiFailure(0, code); };
const utcMillis = value => typeof value === 'string' && /(?:Z|\+00:00)$/.test(value) ? Date.parse(value) : NaN;

// These fixtures deliberately request successful normal-mode execution (quantity 25).
export function verifyCreatedOperation(expected, task, status, external, complete = false) {
  if (task.taskId !== expected.taskId || task.ownerId !== expected.ownerId || task.title !== expected.title ||
      task.request?.reference !== expected.reference || task.request?.quantity !== 25)
    reject('SAVED_REQUEST_CHANGED');
  if (!['QUEUED', 'RETRY_WAIT', 'UNKNOWN', 'ACKNOWLEDGED'].includes(task.deliveryStatus) ||
      !['PENDING', 'RUNNING', 'SUCCEEDED'].includes(task.businessStatus))
    reject('UNEXPECTED_LOCAL_STATE');
  if (status === 404) {
    if (complete || external?.status !== 404 || external.code !== 'OPERATION_NOT_FOUND' || typeof external.title !== 'string' ||
        task.deliveryStatus === 'ACKNOWLEDGED' || task.businessStatus !== 'PENDING')
      reject('EXTERNAL_STATE_CONTRADICTS_LOCAL');
    return { pending: true, notAccepted: true };
  }
  if (status !== 200) throw new ApiFailure(status, 'EXTERNAL_STATE_READ_FAILED');
  if (external?.operationId !== task.operationId || external.request?.reference !== expected.reference || external.request?.quantity !== 25)
    reject('EXTERNAL_IDENTITY_CONFLICT');
  if (external.executions === 0) {
    if (complete || external.result !== null || task.businessStatus !== 'PENDING') reject('EXTERNAL_STATE_CONTRADICTS_LOCAL');
    return { pending: true, notAccepted: false };
  }
  const result = external.result;
  if (external.executions !== 1 || result?.version !== 2 || result.status !== 'SUCCEEDED' || result.rejectionCode !== undefined ||
      result.operationId !== task.operationId || result.request?.reference !== expected.reference || result.request?.quantity !== 25)
    reject('EXTERNAL_RESULT_OR_EXECUTION_CONFLICT');
  const createdAt = utcMillis(task.createdAt), completedAt = utcMillis(result.completedAt);
  const elapsedMs = completedAt - createdAt;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) reject('EXTERNAL_TIME_INVALID');
  if (complete || task.businessStatus === 'SUCCEEDED') {
    if (task.deliveryStatus !== 'ACKNOWLEDGED' || task.businessStatus !== 'SUCCEEDED' || task.result?.status !== 'SUCCEEDED' ||
        utcMillis(task.result.completedAt) !== completedAt || task.result.rejectionCode !== undefined)
      reject('LOCAL_RESULT_DIFFERS');
  }
  return { pending: false, notAccepted: false, elapsedMs };
}

export function verifyTaskHistory(expected, operationId, history) {
  if (!Array.isArray(history.items) || !history.items.length || history.items.some(event =>
    event.taskId !== expected.taskId || event.operationId !== operationId || !Number.isFinite(utcMillis(event.occurredAt))))
    reject('INVALID_RESULT_HISTORY');
  const terminal = history.items.filter(event => event.type === 'RESULT_APPLIED' && event.resultVersion === 2);
  if (terminal.length !== 1 || terminal[0].actor !== 'SYSTEM') reject('RESULT_HISTORY_MISSING_OR_DUPLICATED');
  if (history.totalPages === 1) {
    const creation = history.items.filter(event => event.type === 'CREATED');
    if (creation.length !== 1 || creation[0].actor !== 'USER' || creation[0].actorUserId !== expected.ownerId)
      reject('CREATION_HISTORY_MISSING_OR_CHANGED');
  }
}


export async function verifyCreatedTasks(created, clients, externalOrigin, complete) {
  const durations = [], errors = {};
  let pending = 0, notAccepted = 0;
  await parallel(created, 8, async expected => {
    try {
      const session = clients[expected.client].session;
      const task = await session.get('/api/tasks/' + expected.taskId);
      const response = await fetch(externalOrigin + '/operations/' + task.operationId, { signal: AbortSignal.timeout(10000) });
      const external = await response.json();
      const outcome = verifyCreatedOperation(expected, task, response.status, external, complete);
      if (outcome.pending) { pending++; if (outcome.notAccepted) notAccepted++; }
      else {
        durations.push(outcome.elapsedMs);
        if (complete) verifyTaskHistory(expected, task.operationId, await session.get('/api/tasks/' + expected.taskId + '/history'));
      }
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : error.name;
      errors[code] = (errors[code] || 0) + 1;
    }
  });
  durations.sort((a, b) => a - b);
  return { checked: created.length, completed: durations.length, pending, notAccepted, errors,
    p95Ms: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : null };
}

export function verifyFinishedSnapshot({ app, emulator }, expectedRecords) {
  if (!(app.records > 0) || (expectedRecords !== undefined && app.records !== expectedRecords) ||
      app.records !== emulator.accepted || app.records !== emulator.executed ||
      app.pending !== 0 || app.badLocalState !== 0 || app.queued !== 0 || app.openIssues !== 0 ||
      app.badCreationHistory !== 0 || app.badTerminalHistory !== 0 || app.badRenameHistory !== 0 || emulator.duplicateExecutions !== 0 ||
      emulator.unpublished !== 0 || app.lastCursor !== emulator.lastCursor)
    reject('FINAL_OPERATION_COUNTS_OR_HISTORY_DIFFER');
  for (const field of ['ids', 'requests', 'results']) {
    if (typeof app[field] !== 'string' || app[field] !== emulator[field]) reject('FINAL_OPERATION_CONTENT_DIFFERS');
  }
}
