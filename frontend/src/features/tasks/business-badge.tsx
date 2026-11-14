import { Badge } from '../../shared/ui/badge';
import type { BusinessStatus } from '../../../build/generated/openapi/client';
import { businessLabels } from './model/task-labels';

export function BusinessBadge({ status }: { status: BusinessStatus }) {
  return <Badge tone={status === 'SUCCEEDED' ? 'success' : status === 'REJECTED' ? 'danger' : status === 'RUNNING' ? 'info' : 'neutral'}>{businessLabels[status]}</Badge>;
}
