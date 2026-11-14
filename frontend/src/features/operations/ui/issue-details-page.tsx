import './operations.css';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { BackLink } from '../../../shared/ui/back-link';
import { ActionGroup } from '../../../shared/ui/action-group';
import { Card, CardContent, CardTitle } from '../../../shared/ui/card';
import { PageHeader } from '../../../shared/ui/page-header';
import { Button } from '../../../shared/ui/button';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { timestamp } from '../../../shared/lib/format/timestamp';
import { Loading, RefreshButton } from '../../../shared/ui/feedback';
import { issueKindLabels as kinds } from '../model/issue-labels';
import { Snapshot, ReceivedResult } from './exchange-snapshot';
import { useListReturn } from '../../../shared/lib/router/use-list-return';
import { IssueActions } from './issue-actions';
import { actionLabels } from '../model/decision';
import { issueOptions } from '../api/exchange-queries';

export function IssueCard() {
  const { id = '' } = useParams();
  return <IssueDetails key={id} id={id} />;
}

function IssueDetails({ id }: { id: string }) {
  const returnTo = useListReturn('/issues');
  const issue = useQuery(issueOptions(id));
  if (issue.isPending) return <Loading />;
  if (!issue.data)
    return (
      <>
        <BackLink to={returnTo}>К разбору обмена</BackLink>
        <ErrorMessage error={issue.error} />
        <Button onClick={() => issue.refetch()}>Повторить</Button>
      </>
    );
  const item = issue.data;
  return (
    <>
      <PageHeader
        className="detail-page-header"
        back={<BackLink to={returnTo}>К разбору обмена</BackLink>}
        title={kinds[item.kind]}
        actions={<RefreshButton pending={issue.isFetching} onClick={() => issue.refetch()} />}
      />
      <ErrorMessage error={issue.error} />
      <Card asChild>
        <section aria-labelledby="issue-summary-title">
          <CardContent className="base-page-stack">
            <div className="issue-summary-heading">
              <CardTitle asChild>
                <h2 id="issue-summary-title">{item.status === 'OPEN' ? 'Открытый разбор' : 'Разбор завершён'}</h2>
              </CardTitle>
              <ActionGroup align="start">
                {item.taskId && <Link to={'/tasks/' + item.taskId}>Открыть задание и историю</Link>}
                {item.latestReconciliationId && item.taskId && (
                  <Link to={'/tasks/' + item.taskId + '/reconciliations/' + item.latestReconciliationId}>
                    Открыть последнюю сверку
                  </Link>
                )}
              </ActionGroup>
            </div>
            {item.taskId ? (
              <p>
                {item.requestReference} · {item.taskTitle}
              </p>
            ) : (
              <p>Общая проблема ленты</p>
            )}
            <p>{item.summary}</p>
            <dl className="issue-facts">
              <div>
                <dt>Открыт</dt>
                <dd>
                  <time dateTime={item.openedAt}>{timestamp(item.openedAt)}</time>
                </dd>
              </div>
              <div>
                <dt>Ответственный</dt>
                <dd className={item.assignedTo ? 'technical' : undefined}>{item.assignedTo || 'Не назначен'}</dd>
              </div>
              {item.operationId && (
                <div className="issue-operation">
                  <dt>ID операции</dt>
                  <dd className="technical">{item.operationId}</dd>
                </div>
              )}
              {item.nextAttemptAt && (
                <div>
                  <dt>Следующая попытка</dt>
                  <dd>
                    <time dateTime={item.nextAttemptAt}>{timestamp(item.nextAttemptAt)}</time>
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </section>
      </Card>
      <div className="issue-workspace">
        {item.evidence && (
          <Card asChild>
            <section aria-labelledby="issue-evidence-title">
              <CardContent className="base-page-stack">
                <CardTitle asChild>
                  <h2 id="issue-evidence-title">Диагностика первого события</h2>
                </CardTitle>
                <p className="muted">
                  Сохранённые данные на момент ошибки. Текущее состояние проверяется отдельной сверкой.
                </p>
                {item.evidence.reason !== item.summary && <p>{item.evidence.reason}</p>}
                {item.evidence.cursor && <p>Позиция ленты: {item.evidence.cursor}</p>}
                {(item.evidence.local || item.evidence.received) && (
                  <div className="comparison-grid">
                    {item.evidence.local && (
                      <Snapshot title="Локальный снимок при ошибке" value={item.evidence.local} />
                    )}
                    {item.evidence.received && <ReceivedResult value={item.evidence.received} />}
                  </div>
                )}
              </CardContent>
            </section>
          </Card>
        )}
        <IssueActions key={item.issueId} issue={item} />
        {item.resolution && (
          <Card asChild>
            <section aria-labelledby="issue-resolution-title">
              <CardContent className="base-page-stack">
                <CardTitle asChild>
                  <h2 id="issue-resolution-title">Решение</h2>
                </CardTitle>
                <p>{actionLabels[item.resolution.action]}</p>
                <p className="issue-decision-reason">{item.resolution.reason}</p>
                <dl className="issue-facts">
                  <div>
                    <dt>Принято</dt>
                    <dd>
                      <time dateTime={item.resolution.decidedAt}>{timestamp(item.resolution.decidedAt)}</time>
                    </dd>
                  </div>
                  <div>
                    <dt>Оператор</dt>
                    <dd className="technical">{item.resolution.decidedBy}</dd>
                  </div>
                </dl>
                {item.taskId && (
                  <Link to={'/tasks/' + item.taskId + '/reconciliations/' + item.resolution.reconciliationId}>
                    Сверка, на которой основано решение
                  </Link>
                )}
              </CardContent>
            </section>
          </Card>
        )}
      </div>
    </>
  );
}
