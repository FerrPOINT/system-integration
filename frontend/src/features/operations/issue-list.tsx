import { ErrorMessage } from '../../app/error-message';
import { Notice } from '../../ui/notice';
import { EmptyState } from '../../ui/empty-state';
import { Card, CardContent, CardTitle } from '../../ui/card';
import { PageHeader } from '../../ui/page-header';
import { FormField } from '../../ui/form-field';
import { Select } from '../../ui/select';
import { Button } from '../../ui/button';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { listExchangeIssues } from '../../../build/generated/openapi/client';
import type { IssueStatus } from '../../../build/generated/openapi/client';
import { data, keys } from '../../app/api';
import { timestamp } from '../../app/format';
import { Loading, Pagination, RefreshButton } from '../../ui/Feedback';
import { usePagination } from '../../app/use-pagination';
import { issueKindLabels as kinds } from './issue-labels';

export function IssueList() {
  const [search, setSearch] = useSearchParams();
  const { page, size, valid: validPage, viewportRef, changePage } = usePagination();
  const status = search.get('status') || 'OPEN';
  const valid = validPage && ['OPEN', 'RESOLVED'].includes(status);
  const issues = useQuery({ queryKey: [...keys.issues, 'list', page, size, status], enabled: valid,
    queryFn: ({ signal }) => data(listExchangeIssues({ page, size, status: status as IssueStatus }, { signal })), placeholderData: keepPreviousData });
  return <>
    <div className="list-tools base-page-stack"><PageHeader title="Разбор обмена" context="Доставка, конфликты и решения операторов." actions={<RefreshButton pending={issues.isFetching} disabled={!valid} onClick={() => issues.refetch()} />} />
    <div className="issue-status-filter"><FormField id="issue-status" label="Состояние разбора">{attrs => <Select {...attrs} value={status}
      onValueChange={status => setSearch({ status, size: String(size) })} options={[{ value: 'OPEN', label: 'Открытые' }, { value: 'RESOLVED', label: 'Завершённые' }]} />}</FormField></div></div>
    <section className="paged-list base-page-stack" aria-busy={issues.isFetching}><div className="paged-viewport" ref={viewportRef}>
    {!valid ? <Notice role="alert" tone="danger">Некорректные параметры страницы.</Notice> : issues.isPending ? <Loading /> : !issues.data ?
      <><ErrorMessage error={issues.error} /><Button onClick={() => issues.refetch()}>Повторить</Button></> : <>
      <ErrorMessage error={issues.error} />
      {issues.data.items.length === 0 ? <Card><EmptyState message="Проблем в выбранном состоянии нет." /></Card> :
        <ul className="issue-cards" data-page-items>{issues.data.items.slice(0, size).map(issue => <Card asChild key={issue.issueId} data-page-item><li><CardContent className="base-page-stack">
          <CardTitle asChild><h2><Link className="base-truncate" title={kinds[issue.kind]} to={'/issues/' + issue.issueId}>{kinds[issue.kind]}</Link></h2></CardTitle><p className="base-truncate" title={issue.summary}>{issue.summary}</p>
          <div className="issue-meta"><small>{timestamp(issue.openedAt)}</small><small>{issue.assignedTo ? 'Ответственный: ' + issue.assignedTo : 'Ответственный пока не назначен'}</small>
          {issue.nextAttemptAt && <small>Следующая попытка: {timestamp(issue.nextAttemptAt)}</small>}</div>
        </CardContent></li></Card>)}</ul>}
    </>}
    </div><Pagination page={validPage ? page : 0} totalItems={issues.data?.totalItems ?? 0} totalPages={issues.data?.totalPages ?? 0} pending={issues.isFetching || !valid} onChange={changePage} />
    </section>
  </>;
}
