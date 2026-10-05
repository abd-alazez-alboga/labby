package com.labby.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.dto.AuditLogEntryDto;
import com.labby.backend.dto.AuditLogPageDto;
import com.labby.backend.model.AuditLogEntry;
import com.labby.backend.model.User;
import com.labby.backend.repository.AuditLogRepository;
import com.labby.backend.repository.UserRepository;
import jakarta.persistence.criteria.Predicate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** INSERT-only audit writes plus the filtered query behind UC-A-04. */
@Service
@RequiredArgsConstructor
public class AuditServiceImpl implements AuditService {

  private final AuditLogRepository auditLogRepository;
  private final UserRepository userRepository;
  private final ObjectMapper objectMapper;

  @Override
  @Transactional
  public void record(
      UUID actorUserId,
      String action,
      String targetType,
      String targetId,
      Object before,
      Object after) {
    auditLogRepository.save(
        AuditLogEntry.builder()
            .actorUserId(actorUserId)
            .action(action)
            .targetType(targetType)
            .targetId(targetId)
            .beforeState(toJson(before))
            .afterState(toJson(after))
            .build());
  }

  @Override
  @Transactional(readOnly = true)
  public AuditLogPageDto query(
      UUID actorId,
      String action,
      String targetType,
      String targetId,
      OffsetDateTime from,
      OffsetDateTime to,
      int page,
      int size) {
    Specification<AuditLogEntry> spec =
        (root, query, cb) -> {
          List<Predicate> predicates = new ArrayList<>();
          if (actorId != null) {
            predicates.add(cb.equal(root.get("actorUserId"), actorId));
          }
          if (action != null && !action.isBlank()) {
            predicates.add(cb.equal(root.get("action"), action));
          }
          if (targetType != null && !targetType.isBlank()) {
            predicates.add(cb.equal(root.get("targetType"), targetType));
          }
          if (targetId != null && !targetId.isBlank()) {
            predicates.add(cb.equal(root.get("targetId"), targetId));
          }
          if (from != null) {
            predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), from.toInstant()));
          }
          if (to != null) {
            predicates.add(cb.lessThanOrEqualTo(root.get("createdAt"), to.toInstant()));
          }
          return cb.and(predicates.toArray(Predicate[]::new));
        };
    Page<AuditLogEntry> result =
        auditLogRepository.findAll(
            spec, PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt")));
    Map<UUID, String> actorNames =
        userRepository.findAllById(result.map(AuditLogEntry::getActorUserId).toSet()).stream()
            .collect(Collectors.toMap(User::getId, User::getName));
    List<AuditLogEntryDto> items =
        result.getContent().stream().map(entry -> toDto(entry, actorNames)).toList();
    return new AuditLogPageDto(items, page, size, result.getTotalElements());
  }

  private AuditLogEntryDto toDto(AuditLogEntry entry, Map<UUID, String> actorNames) {
    return new AuditLogEntryDto(
        entry.getId(),
        entry.getActorUserId(),
        actorNames.getOrDefault(entry.getActorUserId(), ""),
        entry.getAction(),
        entry.getTargetType(),
        entry.getTargetId(),
        toJsonNode(entry.getBeforeState()),
        toJsonNode(entry.getAfterState()),
        entry.getCreatedAt().atOffset(ZoneOffset.UTC));
  }

  private String toJson(Object value) {
    if (value == null) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException ex) {
      throw new IllegalStateException("Audit state could not be serialized", ex);
    }
  }

  private JsonNode toJsonNode(String json) {
    if (json == null) {
      return null;
    }
    try {
      return objectMapper.readTree(json);
    } catch (JsonProcessingException ex) {
      throw new IllegalStateException("Stored audit state is not valid JSON", ex);
    }
  }
}
