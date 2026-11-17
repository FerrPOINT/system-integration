import type { RefObject } from 'react';
import { reasonCodePointLimit, reasonMaxLength } from '../../../shared/lib/form-rules';
import type { Issue } from '../../../../build/generated/openapi/client';
import { ActionGroup } from '../../../shared/ui/action-group';
import { Button } from '../../../shared/ui/button';
import { Notice } from '../../../shared/ui/notice';
import { FormField } from '../../../shared/ui/form-field';
import { Select } from '../../../shared/ui/select';
import { Textarea } from '../../../shared/ui/textarea';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { CommandRefresh } from '../../../shared/ui/command-refresh';
import { actionLabels, type DecisionAction } from '../model/decision';
import type { IssueDecisionModel } from '../model/use-issue-decision';

export function DecisionForm({
  issue,
  model,
  reasonInput,
}: {
  issue: Issue;
  model: IssueDecisionModel;
  reasonInput: RefObject<HTMLTextAreaElement | null>;
}) {
  const { action, reason, command, update, actions } = model;
  if (command.isSuccess)
    return (
      <CommandRefresh
        message="Решение сохранено."
        error={update.error}
        pending={update.isPending}
        onRetry={model.refresh}
      />
    );
  if (!actions.length && !model.dirty && !command.isPending) return null;
  return (
    <form
      className="ui-form"
      aria-label="Решение оператора"
      aria-busy={command.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        model.submit();
      }}
    >
      {model.stale && (
        <Notice tone="warning" role="alert">
          <p>Разбор или доступные действия изменились. Черновик сохранён.</p>
          {issue.status === 'OPEN' && (issue.latestReconciliationId || !issue.taskId) && (
            <Button type="button" disabled={model.busy} onClick={model.rebase}>
              Использовать актуальные данные
            </Button>
          )}
        </Notice>
      )}
      <fieldset className="ui-form-fieldset ui-form" disabled={model.busy}>
        {actions.length > 1 && (
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
        )}
        {action === 'RETRY' && (
          <Notice appearance="inline">Обмен продолжится с тем же ID операции и исходным запросом.</Notice>
        )}
        {action === 'APPLY_EXTERNAL_RESULT' && (
          <Notice appearance="inline">Результат выбранной сверки будет применён к заданию, разбор завершится.</Notice>
        )}
        {action === 'ACKNOWLEDGE_DIFFERENCE' && (
          <Notice>
            Результат в приложении сохранится. Если отправка приостановлена, она будет окончательно остановлена.
          </Notice>
        )}
        {action === 'ACKNOWLEDGE_FEED_ISSUE' && (
          <Notice>
            Закрытие фиксирует ваше решение. Оно не исправляет внешний источник и не возобновляет приостановленную
            ленту.
          </Notice>
        )}
        <FormField
          id="decision-reason"
          label="Причина решения"
          required
          hint={`До ${reasonCodePointLimit} символов. Укажите, что проверили и почему выбрали это действие.`}
        >
          {(attrs) => (
            <Textarea
              {...attrs}
              ref={reasonInput}
              value={reason}
              maxLength={reasonMaxLength}
              rows={3}
              onChange={(event) => model.changeReason(event.target.value)}
            />
          )}
        </FormField>
        <ErrorMessage error={command.error} />
      </fieldset>
      <ActionGroup align="start">
        <Button type="submit" variant="default" disabled={!model.canSubmit}>
          {command.isPending ? 'Сохраняем решение…' : action ? actionLabels[action] : 'Сохранить решение'}
        </Button>
        {model.dirty && (
          <Button type="button" disabled={model.busy} onClick={model.resetDraft}>
            Сбросить черновик
          </Button>
        )}
      </ActionGroup>
    </form>
  );
}
