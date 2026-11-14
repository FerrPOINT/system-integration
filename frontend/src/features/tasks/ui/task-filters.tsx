import { utcFilterValue } from '../model/task-search';
import { Notice } from '../../../shared/ui/notice';
import { FormField } from '../../../shared/ui/form-field';
import { Select } from '../../../shared/ui/select';
import { Input } from '../../../shared/ui/input';
import { Button } from '../../../shared/ui/button';
import { Dialog } from '../../../shared/ui/dialog';
import { SlidersHorizontal } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { businessLabels } from '../model/task-labels';

import type { TaskFilters } from '../model/task-search';

export function TaskFilterFields({ params, status, mobile, validPeriod, changeFilters, resetFilters }: {
  params: TaskFilters; status: string | undefined; mobile: boolean; validPeriod: boolean;
  changeFilters: (changes: Record<string, string | undefined>) => void; resetFilters: () => void;
}) {
  return <div className="base-form filters">
      <FormField id="business-status" label="Результат">{attrs => <Select {...attrs} value={status || 'ALL'}
        onValueChange={value => changeFilters({ businessStatus: value === 'ALL' ? undefined : value })}
        options={[{ value: 'ALL', label: 'Все результаты' }, ...Object.entries(businessLabels).map(([value, label]) => ({ value, label }))]} />}</FormField>
      <FormField id="field-createdFrom" label="Создано с (UTC, включительно)">{attrs => <Input {...attrs} type="datetime-local" name="createdFrom" value={utcFilterValue(params.createdFrom)}
        onChange={event => changeFilters({ createdFrom: event.target.value ? event.target.value + ':00Z' : undefined })} />}</FormField>
      <FormField id="field-createdTo" label="Создано до (UTC, не включая)">{attrs => <Input {...attrs} type="datetime-local" name="createdTo" value={utcFilterValue(params.createdTo)}
        onChange={event => changeFilters({ createdTo: event.target.value ? event.target.value + ':00Z' : undefined })} />}</FormField>
      <Button type="button" onClick={() => resetFilters()}>Сбросить</Button>
      {mobile && !validPeriod && <Notice role="alert" tone="danger">Начало периода должно быть раньше конца.</Notice>}
    </div>;
}

export function MobileTaskFilters({ active, children }: { active: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={trigger} type="button" className="base-icon-button mobile-filter-trigger" data-active={active || undefined} aria-label="Фильтры заданий" title={active ? 'Фильтры заданий: заданы условия' : 'Фильтры заданий'}
      aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}><SlidersHorizontal size={20} aria-hidden="true" /></Button>
    <Dialog open={open} title="Фильтры заданий" description="Изменения применяются сразу."
      onClose={() => setOpen(false)} returnFocusRef={trigger}>
      <div className="base-dialog-form">
        <div className="base-dialog-body">{children}</div>
        <div className="base-dialog-footer"><Button type="button" variant="default" onClick={() => setOpen(false)}>Готово</Button></div>
      </div>
    </Dialog>
  </>;
}
