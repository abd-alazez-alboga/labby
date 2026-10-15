package com.labby.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.dto.AccountFlagDto;
import com.labby.backend.dto.AccountFlagPageDto;
import com.labby.backend.dto.FlagResolveRequestDto;
import com.labby.backend.dto.PartySummaryDto;
import com.labby.backend.enums.FlagKind;
import com.labby.backend.enums.FlagStatus;
import com.labby.backend.enums.RideParty;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.AccountFlag;
import com.labby.backend.model.User;
import com.labby.backend.repository.AccountFlagRepository;
import com.labby.backend.repository.UserRepository;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Flag queue persistence and admin handling (see {@link AccountFlagService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class AccountFlagServiceImpl implements AccountFlagService {

  private final AccountFlagRepository accountFlagRepository;
  private final UserRepository userRepository;
  private final AuditService auditService;
  private final ObjectMapper objectMapper;
  private final Clock clock;

  @Override
  public boolean open(UUID userId, RideParty role, FlagKind kind, Map<String, Object> details) {
    String json;
    try {
      json = objectMapper.writeValueAsString(details);
    } catch (JsonProcessingException ex) {
      throw new IllegalStateException("Flag details are not serializable", ex);
    }
    return accountFlagRepository.openIfAbsent(
            userId, role.getValue(), kind.getValue(), json, clock.instant())
        == 1;
  }

  @Override
  @Transactional(readOnly = true)
  public AccountFlagPageDto queue(String status, String kind, UUID userId, int page, int size) {
    FlagStatus statusFilter =
        status == null || status.isBlank() ? FlagStatus.OPEN : parse(status, FlagStatus::fromValue);
    FlagKind kindFilter = kind == null || kind.isBlank() ? null : parse(kind, FlagKind::fromValue);
    Page<AccountFlag> flags =
        accountFlagRepository.findQueue(
            statusFilter.getValue(),
            kindFilter == null ? null : kindFilter.getValue(),
            userId == null ? null : userId.toString(),
            PageRequest.of(page, size));
    return new AccountFlagPageDto(toDtos(flags.getContent()), page, size, flags.getTotalElements());
  }

  @Override
  public AccountFlagDto resolve(UUID actorUserId, UUID flagId, FlagResolveRequestDto request) {
    AccountFlag flag =
        accountFlagRepository
            .findById(flagId)
            .orElseThrow(() -> new ResourceNotFoundException("Flag not found"));
    if (flag.getStatus() != FlagStatus.OPEN
        || accountFlagRepository.resolveIfOpen(
                flagId, request.resolution(), actorUserId, clock.instant(), request.note())
            == 0) {
      throw (ConflictException)
          new ConflictException("This flag is already resolved").withCode("already_resolved");
    }
    Map<String, Object> after = new LinkedHashMap<>();
    after.put("status", request.resolution());
    after.put("note", request.note());
    auditService.record(
        actorUserId,
        "flag.resolve",
        "account_flag",
        flagId.toString(),
        Map.of(
            "status",
            FlagStatus.OPEN.getValue(),
            "userId",
            flag.getUserId().toString(),
            "role",
            flag.getRole().getValue(),
            "kind",
            flag.getKind().getValue()),
        after);
    return toDtos(List.of(accountFlagRepository.findById(flagId).orElseThrow())).get(0);
  }

  @Override
  @Transactional(readOnly = true)
  public List<AccountFlagDto> openFlags(UUID userId) {
    return toDtos(
        accountFlagRepository.findByUserIdAndStatusOrderByRaisedAtAsc(userId, FlagStatus.OPEN));
  }

  private List<AccountFlagDto> toDtos(List<AccountFlag> flags) {
    Map<UUID, User> users =
        userRepository
            .findAllById(flags.stream().map(AccountFlag::getUserId).collect(Collectors.toSet()))
            .stream()
            .collect(Collectors.toMap(User::getId, Function.identity()));
    return flags.stream()
        .map(
            flag ->
                new AccountFlagDto(
                    flag.getId(),
                    new PartySummaryDto(
                        flag.getUserId(),
                        users.containsKey(flag.getUserId())
                            ? users.get(flag.getUserId()).getName()
                            : "",
                        flag.getRole()),
                    flag.getKind(),
                    flag.getStatus(),
                    flag.getDetails(),
                    flag.getRaisedAt(),
                    flag.getResolvedAt(),
                    flag.getResolutionNote()))
        .toList();
  }

  private static <T> T parse(String value, Function<String, T> parser) {
    try {
      return parser.apply(value);
    } catch (IllegalArgumentException ex) {
      throw new InvalidRequestException("Unknown filter value: " + value);
    }
  }
}
