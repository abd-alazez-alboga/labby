package com.labby.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/** Labby backend entry point. */
@SpringBootApplication
@ConfigurationPropertiesScan
public class LabbyApplication {

  public static void main(String[] args) {
    SpringApplication.run(LabbyApplication.class, args);
  }
}
