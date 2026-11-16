import type { Task } from '../../../../build/generated/openapi/client';

export function taskRefreshInterval(task: Pick<Task, 'businessStatus' | 'deliveryStatus'> | undefined): number | false {
  if (!task) return false;
  const quiet =
    task.businessStatus === 'SUCCEEDED' ||
    task.businessStatus === 'REJECTED' ||
    task.deliveryStatus === 'NEEDS_REVIEW' ||
    task.deliveryStatus === 'STOPPED';
  // Settled tasks can still receive audit entries from another user's review.
  return quiet ? 10_000 : 3_000;
}
