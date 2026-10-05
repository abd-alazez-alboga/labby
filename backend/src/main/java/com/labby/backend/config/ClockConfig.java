package com.labby.backend.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The application clock — a bean so time-dependent rules can be tested on a controlled clock. */
@Configuration
public class ClockConfig {

  /** UTC system clock. */
  @Bean
  public Clock clock() {
    return Clock.systemUTC();
  }
}
