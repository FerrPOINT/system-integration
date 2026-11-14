package com.azhukov.integration.config;

import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;

@ConfigurationProperties("si.exchange.http")
public record ExchangeHttpProperties(URI baseUrl, Duration connectTimeout, Duration responseTimeout,
                                     DataSize maxResponseSize) {
    public ExchangeHttpProperties {
        if (baseUrl==null || !("http".equals(baseUrl.getScheme()) || "https".equals(baseUrl.getScheme()))
            || baseUrl.getHost()==null || baseUrl.getUserInfo()!=null
            || !(baseUrl.getPath().isEmpty() || baseUrl.getPath().equals("/"))
            || baseUrl.getQuery()!=null || baseUrl.getFragment()!=null)
            throw new IllegalArgumentException("si.exchange.http.base-url must be an absolute HTTP origin");
        if (connectTimeout==null || connectTimeout.isZero() || connectTimeout.isNegative())
            throw new IllegalArgumentException("si.exchange.http.connect-timeout must be positive");
        // Leave time to persist the outcome before the 15-second delivery lease expires.
        if (responseTimeout==null || responseTimeout.isZero() || responseTimeout.isNegative()
            || responseTimeout.compareTo(Duration.ofSeconds(10))>0 || connectTimeout.compareTo(responseTimeout)>0)
            throw new IllegalArgumentException("si.exchange.http.response-timeout must cover connect-timeout and be at most 10s");
        if (maxResponseSize==null || maxResponseSize.toBytes()<1 || maxResponseSize.toBytes()>1024*1024)
            throw new IllegalArgumentException("si.exchange.http.max-response-size must be 1B..1MB");
    }
}
