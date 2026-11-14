import { ErrorMessage } from '../../app/error-message';
import { Notice } from '../../ui/notice';
import { EmptyState } from '../../ui/empty-state';
import { Card, CardContent, CardTitle } from '../../ui/card';
import { Table } from '../../ui/table';
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
import { useMediaQuery } from '../../ui/use-media-query';
import { issueKindLabels as kinds } from './issue-labels';

export function IssueList() {
  const [search, setSearch] = useSearchParams();
  const { page, size, valid: validPage, viewportRef, changePage } = usePagination();
  const status = search.get('status') || 'OPEN';
  const mobile = useMediaQuery('(max-width: 760px)');
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
      {issues.data.items.length === 0 ? <Card><EmptyState message="Проблем в выбранном состоянии нет." /></Card> : mobile ?
        <ul className="issue-cards" data-page-items>{issues.data.items.slice(0, size).map(issue => <Card asChild key={issue.issueId} data-page-item><li><CardContent className="base-page-stack">
          <CardTitle asChild><h2><Link data-issue-link className="base-truncate" title={kinds[issue.kind]} to={'/issues/' + issue.issueId}>{kinds[issue.kind]}</Link></h2></CardTitle><p className="base-truncate" title={issue.summary}>{issue.summary}</p>
          <div className="issue-meta"><small><time dateTime={issue.openedAt}>{timestamp(issue.openedAt)}</time></small><small>{issue.assignedTo ? 'Ответственный: ' + issue.assignedTo : 'Ответственный пока не назначен'}</small>
          {issue.nextAttemptAt && <small>Следующая попытка: {timestamp(issue.nextAttemptAt)}</small>}</div>
        </CardContent></li></Card>)}</ul> :
        <Card><Table className="issue-table" data-page-items><caption className="sr-only">Реестр разборов обмена</caption>
          <thead data-page-heading><tr><th scope="col">Проблема</th><th scope="col">Ответственный</th><th scope="col">Открыт (UTC)</th></tr></thead>
          <tbody>{issues.data.items.slice(0, size).map(issue => <tr key={issue.issueId} data-page-item>
            <td><Link data-issue-link className="base-truncate" title={kinds[issue.kind]} to={'/issues/' + issue.issueId}>{kinds[issue.kind]}</Link>
              <small className="base-truncate" title={issue.summary}>{issue.summary}</small></td>
            <td><span className={'base-truncate' + (issue.assignedTo ? ' technical' : ' muted')} title={issue.assignedTo}>{issue.assignedTo || 'Не назначен'}</span></td>
            <td><time dateTime={issue.openedAt}>{timestamp(issue.openedAt, { showZone: false })}</time>
              {issue.nextAttemptAt && <small className="base-truncate" title={'Следующая попытка: ' + timestamp(issue.nextAttemptAt)}>
                Повтор: <time dateTime={issue.nextAttemptAt}>{timestamp(issue.nextAttemptAt, { showZone: false })}</time></small>}</td>
          </tr>)}</tbody>
        </Table></Card>}
    </>}
    </div><Pagination page={validPage ? page : 0} size={size} totalItems={issues.data?.totalItems} totalPages={issues.data?.totalPages} pending={issues.isFetching || !valid} onChange={changePage} />
    </section>
  </>;
}
