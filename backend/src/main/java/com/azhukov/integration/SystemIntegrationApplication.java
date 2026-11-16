package com.azhukov.integration;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.task.ThreadPoolTaskSchedulerBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@SpringBootApplication
@EnableScheduling
public class SystemIntegrationApplication {

    @Bean
    ThreadPoolTaskScheduler taskScheduler(ThreadPoolTaskSchedulerBuilder builder) {
        // fixedDelay tasks must progress independently even with virtual HTTP threads.
        return builder.build();
    }

    public static void main(String[] args) {
        SpringApplication.run(SystemIntegrationApplication.class, args);
    }
}
