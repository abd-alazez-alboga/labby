package com.labby.backend.config;

import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.lang.NonNull;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * CORS for browser clients (the admin dashboard). Allowed origins come from the environment; the
 * mobile apps are unaffected (native HTTP has no CORS). {@code Content-Disposition} is exposed so
 * the dashboard can save a CSV export under the server's file name (analytics-v1, M15).
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

  private final String[] allowedOrigins;

  public CorsConfig(@Value("${labby.cors.allowed-origins}") String allowedOrigins) {
    this.allowedOrigins =
        Arrays.stream(allowedOrigins.split(",")).map(String::trim).toArray(String[]::new);
  }

  @Override
  public void addCorsMappings(@NonNull CorsRegistry registry) {
    registry
        .addMapping("/api/**")
        .allowedOrigins(allowedOrigins)
        .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
        .exposedHeaders(HttpHeaders.CONTENT_DISPOSITION);
  }
}
