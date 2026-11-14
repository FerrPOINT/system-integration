import { ArrowRightLeft } from 'lucide-react';
import { IconMark } from '../../shared/ui/icon-mark';

export function Brand() {
  return (
    <span className="app-brand">
      <IconMark>
        <ArrowRightLeft />
      </IconMark>
      <span>Обмен с внешней системой</span>
    </span>
  );
}
