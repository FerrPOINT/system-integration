import { useRef } from 'react';
import type { Issue } from '../../../../build/generated/openapi/client';
import { Button } from '../../../shared/ui/button';
import { Notice } from '../../../shared/ui/notice';
import { FormField } from '../../../shared/ui/form-field';
import { Select } from '../../../shared/ui/select';
import { Textarea } from '../../../shared/ui/textarea';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { CommandRefresh } from '../../../shared/ui/command-refresh';
import { DiscardDialog } from '../../../shared/ui/dialog';
import { actionLabels, type DecisionAction } from '../model/decision';
import type { IssueDecisionModel } from '../model/use-issue-decision';

export function DecisionForm({ issue, model }: { issue: Issue; model: IssueDecisionModel }) {
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const { action, reason, command, update, guard, actions } = model;
  if (!actions.length && !model.dirty && !command.isPending && !command.isSuccess) return null;
  return (
    <>
      <form
        aria-label="Решение оператора"
        aria-busy={command.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          model.submit();
        }}
      >
        {model.stale && !command.isSuccess && (
          <Notice tone="warning" role="alert">
            <p>Разбор или доступные действия изменились. Черновик сохранён.</p>
            {issue.status === 'OPEN' && issue.latestReconciliationId && (
              <Button type="button" disabled={command.isPending} onClick={model.rebase}>
                Использовать актуальную сверку
              </Button>
            )}
          </Notice>
        )}
        <fieldset className="base-form-fieldset base-form" disabled={command.isPending || command.isSuccess}>
          <FormField id="decision-action" label="Действие" required>
            {(attrs) => (
              <Select
                {...attrs}
                value={action}
                placeholder="Выберите действие"
                onValueChange={(value) => model.changeAction(value as DecisionAction)}
                options={actions.map((value) => ({ value, label: actionLabels[value] }))}
              />
            )}
          </FormField>
          {action === 'RETRY' && (
            <Notice appearance="inline">Обмен продолжится с тем же ID операции и исходным запросом.</Notice>
          )}
          {action === 'APPLY_EXTERNAL_RESULT' && (
            <Notice appearance="inline">Результат выбранной сверки будет применён к заданию, разбор завершится.</Notice>
          )}
          {action === 'ACKNOWLEDGE_DIFFERENCE' && (
            <Notice>
              Локальный результат сохранится. Если доставка приостановлена, она будет окончательно остановлена.
            </Notice>
          )}
          <FormField
            id="decision-reason"
            label="Причина решения"
            required
            hint="До 500 символов. Укажите, что проверили и почему выбрали это действие."
          >
            {(attrs) => (
              <Textarea
                {...attrs}
                ref={reasonInput}
                value={reason}
                maxLength={500}
                rows={3}
                onChange={(event) => model.changeReason(event.target.value)}
              />
            )}
          </FormField>
          <ErrorMessage error={command.error} />
          <Button variant="default" disabled={!model.canSubmit}>
            {command.isPending ? 'Сохраняем решение…' : action ? actionLabels[action] : 'Применить решение'}
          </Button>
        </fieldset>
        <CommandRefresh
          message="Решение сохранено."
          error={update.error}
          pending={update.isPending}
          onRetry={model.refresh}
        />
        {model.dirty && (
          <Button type="button" disabled={command.isPending} onClick={model.close}>
            {command.isSuccess ? 'Закрыть' : 'Закрыть черновик'}
          </Button>
        )}
      </form>
      <DiscardDialog open={guard.open} returnFocusRef={reasonInput} onCancel={guard.cancel} onDiscard={guard.discard} />
    </>
  );
}
