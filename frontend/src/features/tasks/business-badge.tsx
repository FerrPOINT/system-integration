import { Badge } from '../../ui/badge';
import type { BusinessStatus } from '../../../build/generated/openapi/client';
import { businessLabels } from '../../app/format';

export function BusinessBadge({ status }: { status: BusinessStatus }) {
  return <Badge tone={status === 'SUCCEEDED' ? 'success' : status === 'REJECTED' ? 'danger' : status === 'RUNNING' ? 'info' : 'neutral'}>{businessLabels[status]}</Badge>;
}
