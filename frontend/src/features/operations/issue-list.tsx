import { ErrorMessage } from '../../shared/ui/error-message';
import { Notice } from '../../shared/ui/notice';
import { EmptyState } from '../../shared/ui/empty-state';
import { Card, CardContent } from '../../shared/ui/card';
import { Table } from '../../shared/ui/table';
import { PageHeader } from '../../shared/ui/page-header';
import { FormField } from '../../shared/ui/form-field';
import { Select } from '../../shared/ui/select';
import { Button } from '../../shared/ui/button';
import { ChevronRight } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { listExchangeIssues } from '../../../build/generated/openapi/client';
import type { IssueStatus, Issue } from '../../../build/generated/openapi/client';
import { exchangeKeys } from './api/exchange-keys';
import { data } from '../../shared/api/http';
import { timestamp } from '../../shared/lib/format/timestamp';
import { Loading, Pagination, RefreshButton } from '../../shared/ui/feedback';
import { usePagination } from '../../shared/lib/pagination/use-pagination';
import { useMediaQuery } from '../../shared/ui/use-media-query';
import { issueKindLabels as kinds } from './issue-labels';
import { useCollectionQuery } from '../../shared/lib/collections/use-collection-query';
import { FeedFooter } from '../../shared/ui/feed-footer';

const identifyIssue = (issue: Issue) => issue.issueId;

export function IssueList() {
  const [search, setSearch] = useSearchParams();
  const mobile = useMediaQuery('(max-width: 760px)');
  const location = useLocation();
  const returnState = { returnTo: location.pathname + location.search };
  const { page, size, valid: validPage, viewportRef, changePage } = usePagination(mobile ? 'feed' : 'pages');
  const status = search.get('status') || 'OPEN';
  const valid = validPage && ['OPEN', 'RESOLVED'].includes(status);
  const { query: issues, items: issuesItems, meta: issuesPage } = useCollectionQuery({ key: exchangeKeys.issueList(status as IssueStatus), page, size, feed: mobile, enabled: valid,
    read: (page, size, signal) => data(listExchangeIssues({ page, size, status: status as IssueStatus }, { signal })), identify: identifyIssue });
  return <>
    <div className="list-tools base-page-stack"><PageHeader title="Разбор обмена" context={mobile ? issuesPage && `Всего: ${issuesPage.totalItems}` : 'Доставка, конфликты и решения операторов.'} actions={<RefreshButton pending={issues.isFetching} disabled={!valid} onClick={() => issues.refetch()} />} />
    <div className="issue-status-filter"><FormField id="issue-status" label="Состояние разбора">{attrs => <Select {...attrs} value={status}
      onValueChange={status => setSearch(mobile ? { status } : { status, size: String(size) })} options={[{ value: 'OPEN', label: 'Открытые' }, { value: 'RESOLVED', label: 'Завершённые' }]} />}</FormField></div></div>
    <section className="paged-list base-page-stack" aria-busy={issues.isFetching}><div className="paged-viewport" ref={viewportRef} data-page-measurement={issues.isError ? 'paused' : undefined}>
    {!valid ? <Notice role="alert" tone="danger">Некорректные параметры страницы.</Notice> : issues.isPending ? <Loading /> : !issuesPage ?
      <><ErrorMessage error={issues.error} /><Button onClick={() => issues.refetch()}>Повторить</Button></> : <>
      {!issues.isFetchNextPageError && <ErrorMessage error={issues.error} />}
      {issuesItems.length === 0 ? <Card><EmptyState message="Проблем в выбранном состоянии нет." /></Card> : mobile ?
        <ul className="issue-cards" data-page-items>{issuesItems.map(issue => <Card asChild key={issue.issueId} data-page-item><li><Link data-issue-link className="mobile-card-link" to={'/issues/' + issue.issueId} state={returnState}><CardContent density="compact" className="mobile-card-content">
          <div className="mobile-card-heading"><h2 className="base-card-title base-truncate">{kinds[issue.kind]}</h2><ChevronRight size={18} aria-hidden="true" /></div><p className="base-truncate" title={issue.summary}>{issue.summary}</p>
          <div className="mobile-card-meta"><small className="base-truncate" title={issue.assignedTo}>{issue.assignedTo ? 'Назначен' : 'Не назначен'}</small><time dateTime={issue.openedAt} title={timestamp(issue.openedAt)}>{timestamp(issue.openedAt, { showZone: false, compact: true })}</time></div>
          {issue.nextAttemptAt && <small>Следующая попытка: {timestamp(issue.nextAttemptAt)}</small>}
        </CardContent></Link></li></Card>)}</ul> :
        <Card><Table className="issue-table" data-page-items><caption className="sr-only">Реестр разборов обмена</caption>
          <thead data-page-heading><tr><th scope="col">Проблема</th><th scope="col">Ответственный</th><th scope="col">Открыт (UTC)</th></tr></thead>
          <tbody>{issuesItems.slice(0, size).map(issue => <tr key={issue.issueId} className="base-linked-row" data-page-item>
            <td><Link data-issue-link className="base-truncate" title={kinds[issue.kind]} to={'/issues/' + issue.issueId} state={returnState}>{kinds[issue.kind]}</Link>
              <small className="base-truncate" title={issue.summary}>{issue.summary}</small></td>
            <td><span className={'base-truncate' + (issue.assignedTo ? ' technical' : ' muted')} title={issue.assignedTo}>{issue.assignedTo || 'Не назначен'}</span></td>
            <td><time dateTime={issue.openedAt}>{timestamp(issue.openedAt, { showZone: false })}</time>
              {issue.nextAttemptAt && <small className="base-truncate" title={'Следующая попытка: ' + timestamp(issue.nextAttemptAt)}>
                Повтор: <time dateTime={issue.nextAttemptAt}>{timestamp(issue.nextAttemptAt, { showZone: false })}</time></small>}</td>
          </tr>)}</tbody>
        </Table></Card>}
    </>}
    </div>{mobile ? valid && issuesPage && <FeedFooter loaded={issuesItems.length} total={issuesPage.totalItems} hasNext={issues.hasNextPage} pending={issues.isFetching}
      error={issues.isFetchNextPageError ? issues.error : null} onLoad={() => issues.fetchNextPage({ cancelRefetch: false })} /> :
      <Pagination page={validPage ? page : 0} size={size} totalItems={issuesPage?.totalItems} totalPages={issuesPage?.totalPages} pending={issues.isFetching || !valid} onChange={changePage} />}
    </section>
  </>;
}
