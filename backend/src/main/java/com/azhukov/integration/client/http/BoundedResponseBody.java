package com.azhukov.integration.client.http;

import java.io.IOException;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;

/**
 * Checks actual bytes before the accumulating string subscriber; Content-Length
 * cannot bound chunked or dishonest responses. Typed TooLarge keeps a protocol
 * size violation distinct from generic transport IOException.
 */
final class BoundedResponseBody implements HttpResponse.BodySubscriber<String> {
    private final HttpResponse.BodySubscriber<String> delegate;
    private final int status;
    private long remaining;
    private Flow.Subscription upstream;
    private boolean finished;

    static HttpResponse.BodyHandler<String> handler(long limit) {
        return response -> new BoundedResponseBody(HttpResponse.BodyHandlers.ofString().apply(response),
            response.statusCode(),limit);
    }

    private BoundedResponseBody(HttpResponse.BodySubscriber<String> delegate,int status,long limit) {
        this.delegate=delegate; this.status=status; this.remaining=limit;
    }

    @Override public CompletionStage<String> getBody() { return delegate.getBody(); }
    @Override public void onSubscribe(Flow.Subscription subscription) {
        upstream=subscription;
        delegate.onSubscribe(subscription);
    }
    @Override public void onNext(List<ByteBuffer> chunks) {
        if (finished) return;
        long bytes=chunks.stream().mapToLong(ByteBuffer::remaining).sum();
        if (bytes>remaining) {
            finished=true;
            upstream.cancel();
            delegate.onError(new TooLarge(status));
            return;
        }
        remaining-=bytes;
        delegate.onNext(chunks);
    }
    @Override public void onError(Throwable error) {
        if (!finished) { finished=true; delegate.onError(error); }
    }
    @Override public void onComplete() {
        if (!finished) { finished=true; delegate.onComplete(); }
    }

    static final class TooLarge extends IOException {
        private final int status;
        TooLarge(int status) { super("Внешний ответ превышает допустимый размер"); this.status=status; }
        int status() { return status; }
    }
}
