package com.labby.backend.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** springdoc-openapi metadata; package scanning is restricted in {@code application.yml}. */
@Configuration
public class OpenApiConfig {

  @Bean
  public OpenAPI labbyOpenApi(@Value("${spring.application.name}") String applicationName) {
    return new OpenAPI()
        .info(
            new Info()
                .title(applicationName)
                .description("Labby ride-sharing backend API")
                .version("v1"));
  }
}
