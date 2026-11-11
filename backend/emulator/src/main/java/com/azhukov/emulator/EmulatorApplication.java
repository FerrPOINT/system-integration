package com.azhukov.emulator;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class EmulatorApplication {
    public static void main(String[] args) { SpringApplication.run(EmulatorApplication.class, args); }
}
