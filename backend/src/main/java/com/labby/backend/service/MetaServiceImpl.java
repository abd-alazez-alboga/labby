package com.labby.backend.service;

import com.labby.backend.dto.MetaResponseDto;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.info.BuildProperties;
import org.springframework.stereotype.Service;

/** Default {@link MetaService} backed by the Maven-generated Spring Boot build info. */
@Service
@RequiredArgsConstructor
public class MetaServiceImpl implements MetaService {

  private final BuildProperties buildProperties;

  @Override
  public MetaResponseDto getMeta() {
    return new MetaResponseDto(buildProperties.getName(), buildProperties.getVersion());
  }
}
