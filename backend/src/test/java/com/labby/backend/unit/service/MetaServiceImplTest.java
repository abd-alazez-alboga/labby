package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.labby.backend.dto.MetaResponseDto;
import com.labby.backend.service.MetaServiceImpl;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.boot.info.BuildProperties;

/** Unit tests for {@link MetaServiceImpl}. */
@ExtendWith(MockitoExtension.class)
class MetaServiceImplTest {

  @Mock private BuildProperties buildProperties;

  @InjectMocks private MetaServiceImpl metaService;

  @Test
  @DisplayName("should return name and version from build properties")
  void shouldReturnNameAndVersionWhenBuildInfoPresent() {
    when(buildProperties.getName()).thenReturn("labby-backend");
    when(buildProperties.getVersion()).thenReturn("0.1.0");

    MetaResponseDto meta = metaService.getMeta();

    assertThat(meta.name()).isEqualTo("labby-backend");
    assertThat(meta.version()).isEqualTo("0.1.0");
  }
}
