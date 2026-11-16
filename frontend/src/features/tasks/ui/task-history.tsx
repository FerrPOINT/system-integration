import { Disclosure } from '../../../shared/ui/disclosure';
import { technicalHistoryLabels } from '../model/task-labels';
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
import { useCollection } from '../../../shared/lib/collections/use-collection';
import { FeedFooter, FeedStart } from '../../../shared/ui/feed-footer';
import { readHistoryPage } from '../api/task-queries';

const identifyHistoryEvent = (event: HistoryEvent) => event.eventId;

export function History({
  id,
  canReview,
  refreshInterval,
}: {
  id: string;
  canReview: boolean;
  refreshInterval: number | false;
}) {
  const mobile = useMediaQuery('(max-width: 760px)');
  const { page, size, valid, viewportRef, changePage } = usePagination(mobile ? 'feed' : 'pages');
  const collection = useCollection({
    key: taskKeys.history(id),
    page,
    size,
    feed: mobile,
    enabled: valid,
    viewportRef,
    read: (page, size, signal) => readHistoryPage(id, page, size, signal),
    identify: identifyHistoryEvent,
    refreshInterval,
  });
  const { query: history, items: historyItems, meta: historyPage } = collection;
  const { viewportRef: registryRef, restoring, positionNotice, loadNext, loadPrevious, refresh } = collection;
  // Measure the available column, independent of the card's content height.
  return (
    <div className="task-history-viewport" ref={registryRef} data-feed-viewport={mobile || undefined}>
      <Card asChild>
        <section className="history-panel" aria-labelledby="task-history-title">
          <CardContent className="paged-list base-page-stack" aria-busy={history.isFetching || restoring}>
            <CardTitle asChild>
              <h2 id="task-history-title">История</h2>
            </CardTitle>
            <div className="paged-viewport">
              {mobile && valid && historyPage && (
                <FeedStart
                  hasPrevious={history.hasPreviousPage}
                  pending={history.isFetchingPreviousPage}
                  busy={history.isFetching}
                  error={history.isFetchPreviousPageError ? history.error : null}
                  autoLoad={!restoring && !history.isFetchPreviousPageError && !history.isFetchNextPageError}
                  onLoad={loadPrevious}
                />
              )}
              {!valid ? (
                <Notice role="alert" tone="danger">
                  Некорректные параметры страницы.
                </Notice>
              ) : history.isPending ? (
                <Loading />
              ) : !historyPage ? (
                <>
                  <ErrorMessage error={history.error} />
                  <Button onClick={() => refresh()}>Повторить</Button>
                </>
              ) : (
                <>
                  {!history.isFetchNextPageError && !history.isFetchPreviousPageError && (
                    <ErrorMessage error={history.error} />
                  )}
                  <Timeline data-page-items>
                    {historyItems.map((event) => (
                      <TimelineItem
                        key={event.eventId}
                        data-page-item
                        data-event-id={event.eventId}
                        data-record-id={event.eventId}
                      >
                        <TimelineMarker />
                        <TimelineContent>
                          {technicalHistoryLabels[event.type] ? (
                            <>
                              <p>{technicalHistoryLabels[event.type]}</p>
                              <Disclosure summary="Подробности обмена" size="sm" tone="muted">
                                <p>{event.summary}</p>
                              </Disclosure>
                            </>
                          ) : (
                            <p>{event.summary}</p>
                          )}
                          <small title={event.actorUserId}>
                            <time dateTime={event.occurredAt} title={timestamp(event.occurredAt)}>
                              {timestamp(event.occurredAt, { compact: mobile, showZone: !mobile })}
                            </time>{' '}
                            ·{event.actor === 'SYSTEM' ? ' Система' : ` ${event.actorUsername}`}
                          </small>
                          {canReview && event.reconciliationId && (
                            <Link to={'/tasks/' + id + '/reconciliations/' + event.reconciliationId}>
                              Открыть сохранённую сверку
                            </Link>
                          )}
                          {canReview && event.issueId && <Link to={'/issues/' + event.issueId}>Открыть разбор</Link>}
                        </TimelineContent>
                      </TimelineItem>
                    ))}
                  </Timeline>
                </>
              )}
            </div>
            {mobile ? (
              valid &&
              historyPage && (
                <FeedFooter
                  loaded={historyItems.length}
                  total={historyPage.totalItems}
                  start={historyPage.firstPage * size + 1}
                  end={Math.min((historyPage.page + 1) * size, historyPage.totalItems)}
                  hasNext={history.hasNextPage}
                  pending={history.isFetchingNextPage}
                  busy={history.isFetching}
                  notice={positionNotice}
                  autoLoad={!restoring && !history.isFetchPreviousPageError && !history.isFetchNextPageError}
                  error={history.isFetchNextPageError ? history.error : null}
                  onLoad={loadNext}
                />
              )
            ) : (
              <Pagination
                page={valid ? page : 0}
                size={size}
                totalItems={historyPage?.totalItems}
                totalPages={historyPage?.totalPages}
                pending={history.isFetching || !valid}
                onChange={changePage}
              />
            )}
          </CardContent>
        </section>
      </Card>
    </div>
  );
}
