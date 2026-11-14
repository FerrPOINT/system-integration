import './operations.css';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { Notice } from '../../../shared/ui/notice';
import { EmptyState } from '../../../shared/ui/empty-state';
import { Card, CardContent } from '../../../shared/ui/card';
import { Table } from '../../../shared/ui/table';
import { PageHeader } from '../../../shared/ui/page-header';
import { FormField } from '../../../shared/ui/form-field';
import { Select } from '../../../shared/ui/select';
import { Button } from '../../../shared/ui/button';
import { ChevronRight } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { IssueStatus, Issue } from '../../../../build/generated/openapi/client';
import { exchangeKeys } from '../api/exchange-keys';
import { readIssuePage } from '../api/exchange-queries';
import { timestamp } from '../../../shared/lib/format/timestamp';
import { Loading, Pagination, RefreshButton } from '../../../shared/ui/feedback';
import { usePagination } from '../../../shared/lib/pagination/use-pagination';
import { useMediaQuery } from '../../../shared/ui/use-media-query';
import { issueKindLabels as kinds } from '../model/issue-labels';
import { useCollection } from '../../../shared/lib/collections/use-collection';
import { FeedFooter, FeedStart } from '../../../shared/ui/feed-footer';

const identifyIssue = (issue: Issue) => issue.issueId;

export function IssueList() {
  const [search, setSearch] = useSearchParams();
  const mobile = useMediaQuery('(max-width: 760px)');
  const location = useLocation();
  const returnState = { returnTo: location.pathname + location.search };
  const { page, size, valid: validPage, viewportRef, changePage } = usePagination(mobile ? 'feed' : 'pages');
  const status = search.get('status') || 'OPEN';
  const valid = validPage && ['OPEN', 'RESOLVED'].includes(status);
  const collection = useCollection({ key: exchangeKeys.issueList(status as IssueStatus), page, size, feed: mobile, enabled: valid, viewportRef,
    read: (page, size, signal) => readIssuePage({ page, size, status: status as IssueStatus }, signal), identify: identifyIssue });
  const { query: issues, items: issuesItems, meta: issuesPage } = collection;
  const { viewportRef: registryRef, restoring, positionNotice, loadNext, loadPrevious, refresh } = collection;
  return <>
    <div className="list-tools base-page-stack"><PageHeader title="Разбор обмена" context={mobile ? issuesPage && `Всего: ${issuesPage.totalItems}` : 'Доставка, конфликты и решения операторов.'} actions={<RefreshButton pending={issues.isFetching} disabled={!valid} onClick={() => refresh()} />} />
    <div className="issue-status-filter"><FormField id="issue-status" label="Состояние разбора">{attrs => <Select {...attrs} value={status}
      onValueChange={status => setSearch(mobile ? { status } : { status, size: String(size) })} options={[{ value: 'OPEN', label: 'Открытые' }, { value: 'RESOLVED', label: 'Завершённые' }]} />}</FormField></div></div>
    <section className="paged-list base-page-stack" aria-busy={issues.isFetching || restoring}><div className="paged-viewport" ref={registryRef} data-feed-viewport={mobile || undefined} data-page-measurement={issues.isError ? 'paused' : undefined}>
    {mobile && valid && issuesPage && <FeedStart hasPrevious={issues.hasPreviousPage} pending={issues.isFetchingPreviousPage} busy={issues.isFetching}
      error={issues.isFetchPreviousPageError ? issues.error : null} autoLoad={!restoring && !issues.isFetchPreviousPageError && !issues.isFetchNextPageError} onLoad={loadPrevious} />}
    {!valid ? <Notice role="alert" tone="danger">Некорректные параметры страницы.</Notice> : issues.isPending ? <Loading /> : !issuesPage ?
      <><ErrorMessage error={issues.error} /><Button onClick={() => refresh()}>Повторить</Button></> : <>
      {!issues.isFetchNextPageError && !issues.isFetchPreviousPageError && <ErrorMessage error={issues.error} />}
      {issuesItems.length === 0 ? <Card><EmptyState message="Проблем в выбранном состоянии нет." /></Card> : mobile ?
        <ul className="issue-cards" data-page-items>{issuesItems.map(issue => <Card asChild key={issue.issueId} data-page-item><li data-record-id={issue.issueId}><Link data-issue-link className="mobile-card-link" to={'/issues/' + issue.issueId} state={returnState}><CardContent density="compact" className="mobile-card-content">
          <div className="mobile-card-heading"><h2 className="base-card-title base-truncate">{kinds[issue.kind]}</h2><ChevronRight size={18} aria-hidden="true" /></div><p className="base-truncate" title={issue.summary}>{issue.summary}</p>
          <div className="mobile-card-meta"><small className="base-truncate" title={issue.assignedTo}>{issue.assignedTo ? 'Назначен' : 'Не назначен'}</small><time dateTime={issue.openedAt} title={timestamp(issue.openedAt)}>{timestamp(issue.openedAt, { showZone: false, compact: true })}</time></div>
          {issue.nextAttemptAt && <small>Следующая попытка: {timestamp(issue.nextAttemptAt)}</small>}
        </CardContent></Link></li></Card>)}</ul> :
        <Card><Table className="issue-table" data-page-items><caption className="sr-only">Реестр разборов обмена</caption>
          <thead data-page-heading><tr><th scope="col">Проблема</th><th scope="col">Ответственный</th><th scope="col">Открыт (UTC)</th></tr></thead>
          <tbody>{issuesItems.slice(0, size).map(issue => <tr key={issue.issueId} className="base-linked-row" data-page-item data-record-id={issue.issueId}>
            <td><Link data-issue-link className="base-truncate" title={kinds[issue.kind]} to={'/issues/' + issue.issueId} state={returnState}>{kinds[issue.kind]}</Link>
              <small className="base-truncate" title={issue.summary}>{issue.summary}</small></td>
            <td><span className={'base-truncate' + (issue.assignedTo ? ' technical' : ' muted')} title={issue.assignedTo}>{issue.assignedTo || 'Не назначен'}</span></td>
            <td><time dateTime={issue.openedAt}>{timestamp(issue.openedAt, { showZone: false })}</time>
              {issue.nextAttemptAt && <small className="base-truncate" title={'Следующая попытка: ' + timestamp(issue.nextAttemptAt)}>
                Повтор: <time dateTime={issue.nextAttemptAt}>{timestamp(issue.nextAttemptAt, { showZone: false })}</time></small>}</td>
          </tr>)}</tbody>
        </Table></Card>}
    </>}
    </div>{mobile ? valid && issuesPage && <FeedFooter loaded={issuesItems.length} total={issuesPage.totalItems} start={issuesPage.firstPage * size + 1} end={Math.min((issuesPage.page + 1) * size, issuesPage.totalItems)}
      hasNext={issues.hasNextPage} pending={issues.isFetchingNextPage} busy={issues.isFetching} notice={positionNotice}
      autoLoad={!restoring && !issues.isFetchPreviousPageError && !issues.isFetchNextPageError}
      error={issues.isFetchNextPageError ? issues.error : null} onLoad={loadNext} /> :
      <Pagination page={validPage ? page : 0} size={size} totalItems={issuesPage?.totalItems} totalPages={issuesPage?.totalPages} pending={issues.isFetching || !valid} onChange={changePage} />}
    </section>
  </>;
}
