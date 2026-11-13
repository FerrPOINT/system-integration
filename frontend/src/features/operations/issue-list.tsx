import { ErrorMessage } from '../../app/error-message';
import { Notice } from '../../ui/notice';
import { EmptyState } from '../../ui/empty-state';
import { Card, CardContent, CardTitle } from '../../ui/card';
import { PageHeader } from '../../ui/page-header';
import { FormField } from '../../ui/form-field';
import { Select } from '../../ui/select';
import { Button } from '../../ui/button';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { listExchangeIssues } from '../../../build/generated/openapi/client';
import type { IssueStatus } from '../../../build/generated/openapi/client';
import { data, keys } from '../../app/api';
import { timestamp } from '../../app/format';
import { Loading, Pagination } from '../../ui/Feedback';
import { issueKindLabels } from './issue-labels';

export function IssueList() {
  const [search, setSearch] = useSearchParams();
  const page = Number(search.get('page') || 0);
  const status = search.get('status') || 'OPEN';
  const valid = Number.isSafeInteger(page) && page >= 0 && ['OPEN', 'RESOLVED'].includes(status);
  const issues = useQuery({ queryKey: [...keys.issues, 'list', page, status], enabled: valid,
    queryFn: ({ signal }) => data(listExchangeIssues({ page, status: status as IssueStatus }, { signal })) });
  return <>
    <PageHeader title="Разбор обмена" context="Доставка, конфликты и решения операторов." actions={<Button onClick={() => issues.refetch()} disabled={issues.isFetching || !valid}>Обновить</Button>} />
    <div className="readable"><FormField id="issue-status" label="Состояние разбора">{attrs => <Select {...attrs} value={status}
      onValueChange={status => setSearch({ status })} options={[{ value: 'OPEN', label: 'Открытые' }, { value: 'RESOLVED', label: 'Завершённые' }]} />}</FormField></div>
    {!valid ? <Notice role="alert" tone="danger">Некорректные параметры страницы.</Notice> : issues.isPending ? <Loading /> : !issues.data ?
      <><ErrorMessage error={issues.error} /><Button onClick={() => issues.refetch()}>Повторить</Button></> : <>
      <ErrorMessage error={issues.error} />
      {issues.data.items.length === 0 ? <Card><EmptyState message="Проблем в выбранном состоянии нет." /></Card> :
        <ul className="issue-cards">{issues.data.items.map(issue => <Card asChild key={issue.issueId}><li><CardContent className="base-page-stack">
          <CardTitle asChild><h2><Link to={'/issues/' + issue.issueId}>{issueKindLabels[issue.kind]}</Link></h2></CardTitle><p>{issue.summary}</p>
          <div className="issue-meta"><small>{timestamp(issue.openedAt)}</small><small>{issue.assignedTo ? 'Ответственный: ' + issue.assignedTo : 'Ответственный пока не назначен'}</small>
          {issue.nextAttemptAt && <small>Следующая попытка: {timestamp(issue.nextAttemptAt)}</small>}</div>
        </CardContent></li></Card>)}</ul>}
      <Pagination page={page} totalItems={issues.data.totalItems} totalPages={issues.data.totalPages} pending={issues.isFetching}
        onChange={next => setSearch({ status, page: String(next) })} />
    </>}
  </>;
}
