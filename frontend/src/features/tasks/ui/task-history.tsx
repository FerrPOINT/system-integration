import { ErrorMessage } from '../../../shared/ui/error-message';
import { Notice } from '../../../shared/ui/notice';
import { Timeline, TimelineItem, TimelineMarker, TimelineContent } from '../../../shared/ui/timeline';
import { Card, CardContent, CardTitle } from '../../../shared/ui/card';
import { Button } from '../../../shared/ui/button';
import { Link } from 'react-router-dom';
import type { HistoryEvent } from '../../../../build/generated/openapi/client';
import { taskKeys } from '../api/task-keys';
import { Loading, Pagination } from '../../../shared/ui/feedback';
import { timestamp } from '../../../shared/lib/format/timestamp';
import { usePagination } from '../../../shared/lib/pagination/use-pagination';
import { useMediaQuery } from '../../../shared/ui/use-media-query';
import { useCollectionQuery } from '../../../shared/lib/collections/use-collection-query';
import { FeedFooter } from '../../../shared/ui/feed-footer';
import { readHistoryPage } from '../api/task-queries';

const identifyHistoryEvent = (event: HistoryEvent) => event.eventId;

export function History({ id, canReview, refreshInterval }: { id: string; canReview: boolean; refreshInterval: number | false }) {
  const mobile = useMediaQuery('(max-width: 760px)');
  const { page, size, valid, viewportRef, changePage } = usePagination(mobile ? 'feed' : 'pages');
  const { query: history, items: historyItems, meta: historyPage } = useCollectionQuery({ key: taskKeys.history(id), page, size, feed: mobile, enabled: valid,
    read: (page, size, signal) => readHistoryPage(id, page, size, signal), identify: identifyHistoryEvent, refreshInterval });
  // Measure the available column, independent of the card's content height.
  return <div className="task-history-viewport" ref={viewportRef}>
    <Card asChild><section className="history-panel" aria-labelledby="task-history-title"><CardContent className="paged-list base-page-stack" aria-busy={history.isFetching}><CardTitle asChild><h2 id="task-history-title">История</h2></CardTitle>
    <div className="paged-viewport">
    {!valid ? <Notice role="alert" tone="danger">Некорректные параметры страницы.</Notice> : history.isPending ? <Loading /> : !historyPage ? <><ErrorMessage error={history.error} />
      <Button onClick={() => history.refetch()}>Повторить</Button></> : <>
      {!history.isFetchNextPageError && <ErrorMessage error={history.error} />}
      <Timeline data-page-items>{historyItems.map(event => <TimelineItem key={event.eventId} data-page-item data-event-id={event.eventId}><TimelineMarker /><TimelineContent>
        <p className="base-truncate" title={event.summary}>{event.summary}</p><small title={event.actorUserId}><time dateTime={event.occurredAt} title={timestamp(event.occurredAt)}>{timestamp(event.occurredAt, { compact: mobile, showZone: !mobile })}</time> ·
          {event.actor === 'SYSTEM' ? ' Система' : ` Пользователь ${mobile ? event.actorUserId?.slice(0, 8) : event.actorUserId}`}</small>
        {canReview && event.reconciliationId && <Link to={'/tasks/' + id + '/reconciliations/' + event.reconciliationId}>Открыть сохранённую сверку</Link>}
        {canReview && event.issueId && <Link to={'/issues/' + event.issueId}>Открыть разбор</Link>}
      </TimelineContent></TimelineItem>)}</Timeline>
    </>}
    </div>
    {mobile ? valid && historyPage && <FeedFooter loaded={historyItems.length} total={historyPage.totalItems} hasNext={history.hasNextPage} pending={history.isFetching}
      error={history.isFetchNextPageError ? history.error : null} onLoad={() => history.fetchNextPage({ cancelRefetch: false })} /> :
      <Pagination page={valid ? page : 0} size={size} totalItems={historyPage?.totalItems} totalPages={historyPage?.totalPages} pending={history.isFetching || !valid} onChange={changePage} />}
  </CardContent></section></Card></div>;
}
