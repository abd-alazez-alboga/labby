package com.labby.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.exception.ErrorResponse;
import com.labby.backend.security.JwtAuthFilter;
import com.labby.backend.security.JwtService;
import com.labby.backend.service.PermissionService;
import com.labby.backend.service.SessionService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * Deny-by-default, stateless security (NFR-S3). Whitelist: auth endpoints, public meta, health, the
 * API docs, and expiring file URLs (their signed token is the capability — NFR-S2, M5). Everything
 * else needs a valid Bearer access token. Method-level security is enabled for the role/permission
 * checks of later milestones.
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

  /**
   * Builds the single stateless filter chain.
   *
   * @param http the builder
   * @param jwtService parses Bearer access tokens for the auth filter
   * @param sessionService checks the token's session is not revoked (UC-S-03)
   * @param permissionService resolves admin {@code domain:action} authorities per request (RBAC-03)
   * @param objectMapper serializes the 401 error body
   * @return the chain
   * @throws Exception from the builder
   */
  @Bean
  public SecurityFilterChain securityFilterChain(
      HttpSecurity http,
      JwtService jwtService,
      SessionService sessionService,
      PermissionService permissionService,
      ObjectMapper objectMapper)
      throws Exception {
    http.csrf(csrf -> csrf.disable())
        .cors(Customizer.withDefaults())
        .sessionManagement(
            session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            auth ->
                auth.requestMatchers(
                        "/api/v1/auth/**",
                        "/api/v1/meta",
                        "/api/v1/files/*",
                        "/actuator/health",
                        "/actuator/health/**",
                        "/swagger-ui.html",
                        "/swagger-ui/**",
                        "/v3/api-docs/**")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .exceptionHandling(handler -> handler.authenticationEntryPoint(entryPoint(objectMapper)))
        .httpBasic(basic -> basic.disable())
        .formLogin(form -> form.disable())
        .addFilterBefore(
            new JwtAuthFilter(jwtService, sessionService, permissionService),
            UsernamePasswordAuthenticationFilter.class);
    return http.build();
  }

  /** BCrypt for passwords and OTP hashes (NFR-S1). */
  @Bean
  public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder();
  }

  private static AuthenticationEntryPoint entryPoint(ObjectMapper objectMapper) {
    return (request, response, authException) -> {
      response.setStatus(HttpStatus.UNAUTHORIZED.value());
      response.setContentType(MediaType.APPLICATION_JSON_VALUE);
      response
          .getWriter()
          .write(
              objectMapper.writeValueAsString(
                  ErrorResponse.of(
                      HttpStatus.UNAUTHORIZED.value(),
                      HttpStatus.UNAUTHORIZED.getReasonPhrase(),
                      "Authentication required")));
    };
  }
}
