package com.azhukov.integration.config;

import java.net.http.HttpClient;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(ExchangeHttpProperties.class)
public class ExchangeHttpConfiguration {
    @Bean
    public HttpClient exchangeHttpClient(ExchangeHttpProperties settings) {
        return HttpClient.newBuilder()
                .connectTimeout(settings.connectTimeout())
                .version(HttpClient.Version.HTTP_1_1)
                .build();
    }
}
