package com.abada.engine;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

import com.abada.engine.identity.IdentityProperties;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties(IdentityProperties.class)
public class AbadaEngineApplication {

    public static void main(String[] args) {
        SpringApplication.run(AbadaEngineApplication.class, args);
    }

}
