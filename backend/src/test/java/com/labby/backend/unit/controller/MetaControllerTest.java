package com.labby.backend.unit.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.labby.backend.controller.MetaController;
import com.labby.backend.dto.MetaResponseDto;
import com.labby.backend.service.MetaService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Web-layer tests for {@link MetaController}. */
@WebMvcTest(MetaController.class)
class MetaControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private MetaService metaService;

  @Test
  @DisplayName("should return 200 with name and version")
  void shouldReturnMetaWhenRequested() throws Exception {
    when(metaService.getMeta()).thenReturn(new MetaResponseDto("labby-backend", "0.1.0"));

    mockMvc
        .perform(get("/api/v1/meta"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("labby-backend"))
        .andExpect(jsonPath("$.version").value("0.1.0"));
  }
}
