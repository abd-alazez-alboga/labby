package com.labby.backend.unit.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.labby.backend.exception.GlobalExceptionHandler;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP mapping of {@link GlobalExceptionHandler} on a standalone MockMvc (no Spring context): a
 * statement that hit the analytics {@code statement_timeout} answers 503 {@code query_timeout}
 * (analytics-v1.yaml).
 */
class GlobalExceptionHandlerTest {

  /**
   * A test-only endpoint. Nested in a test class, so Spring Boot's {@code TestTypeExcludeFilter}
   * keeps it out of every application context's component scan.
   */
  @RestController
  static class SlowQueryEndpoint {

    @GetMapping("/slow")
    String slow() {
      throw new QueryTimeoutException("canceling statement due to statement timeout");
    }
  }

  private final MockMvc mockMvc =
      MockMvcBuilders.standaloneSetup(new SlowQueryEndpoint())
          .setControllerAdvice(new GlobalExceptionHandler())
          .build();

  @Test
  @DisplayName("QueryTimeoutException → 503 with code query_timeout")
  void shouldAnswer503QueryTimeout() throws Exception {
    mockMvc
        .perform(get("/slow"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.status").value(503))
        .andExpect(jsonPath("$.code").value("query_timeout"));
  }
}
