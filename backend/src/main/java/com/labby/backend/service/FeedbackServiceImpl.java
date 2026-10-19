package com.labby.backend.service;

import com.labby.backend.dto.AdminFeedbackDto;
import com.labby.backend.dto.AdminFeedbackPageDto;
import com.labby.backend.dto.FeedbackDto;
import com.labby.backend.dto.FeedbackRequestDto;
import com.labby.backend.dto.FeedbackStatsDto;
import com.labby.backend.dto.PartySummaryDto;
import com.labby.backend.enums.FeedbackCategory;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.Role;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Feedback;
import com.labby.backend.model.FeedbackTag;
import com.labby.backend.model.User;
import com.labby.backend.repository.FeedbackRepository;
import com.labby.backend.repository.FeedbackTagRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.repository.projection.FeedbackBucketRow;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Feedback (see {@link FeedbackService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class FeedbackServiceImpl implements FeedbackService {

  static final int MAX_TAG_LENGTH = 30;
  static final int MAX_RANGE_DAYS = 366;
  static final Set<String> BUCKETS = Set.of("day", "week", "month");

  private final FeedbackRepository feedbackRepository;
  private final FeedbackTagRepository feedbackTagRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final UserRepository userRepository;
  private final AuditService auditService;
  private final Clock clock;

  @Override
  public FeedbackDto submit(UUID userId, FeedbackRequestDto request) {
    FeedbackCategory category;
    try {
      category = FeedbackCategory.fromValue(request.category());
    } catch (IllegalArgumentException ex) {
      throw (InvalidRequestException)
          new InvalidRequestException("Unknown feedback category").withCode("invalid_category");
    }
    Role role = request.submittedAs() == RideParty.DRIVER ? Role.DRIVER : Role.RIDER;
    if (!roleAssignmentRepository.existsByUserIdAndRole(userId, role)) {
      throw new ForbiddenException(
          "This account has no " + request.submittedAs().getValue() + " role");
    }
    Feedback feedback =
        feedbackRepository.save(
            Feedback.builder()
                .userId(userId)
                .submittedAs(request.submittedAs())
                .category(category)
                .body(request.body().trim())
                .createdAt(clock.instant())
                .build());
    return view(feedback);
  }

  @Override
  @Transactional(readOnly = true)
  public AdminFeedbackPageDto adminList(
      FeedbackCategory category,
      String tag,
      RideParty submittedAs,
      Instant from,
      Instant to,
      int page,
      int size) {
    String tagFilter = tag == null || tag.isBlank() ? null : tag.trim().toLowerCase();
    Specification<Feedback> spec =
        (root, query, cb) -> {
          List<Predicate> predicates = new ArrayList<>();
          if (category != null) {
            predicates.add(cb.equal(root.get("category"), category));
          }
          if (submittedAs != null) {
            predicates.add(cb.equal(root.get("submittedAs"), submittedAs));
          }
          if (from != null) {
            predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), from));
          }
          if (to != null) {
            predicates.add(cb.lessThan(root.get("createdAt"), to));
          }
          if (tagFilter != null) {
            Subquery<UUID> tagged = query.subquery(UUID.class);
            Root<FeedbackTag> tagRoot = tagged.from(FeedbackTag.class);
            tagged
                .select(tagRoot.get("feedbackId"))
                .where(
                    cb.equal(tagRoot.get("feedbackId"), root.get("id")),
                    cb.equal(tagRoot.get("tag"), tagFilter));
            predicates.add(cb.exists(tagged));
          }
          return cb.and(predicates.toArray(Predicate[]::new));
        };
    Page<Feedback> entries =
        feedbackRepository.findAll(
            spec,
            PageRequest.of(
                page, size, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
    return new AdminFeedbackPageDto(
        adminViews(entries.getContent()), page, size, entries.getTotalElements());
  }

  @Override
  @Transactional(readOnly = true)
  public FeedbackStatsDto stats(Instant from, Instant to, String bucket, RideParty submittedAs) {
    String unit = bucket == null || bucket.isBlank() ? "day" : bucket.toLowerCase();
    if (!BUCKETS.contains(unit)) {
      throw new InvalidRequestException("bucket must be day, week or month");
    }
    if (from == null
        || to == null
        || !to.isAfter(from)
        || Duration.between(from, to).toDays() > MAX_RANGE_DAYS) {
      throw (InvalidRequestException)
          new InvalidRequestException("The range must be ascending and at most 366 days")
              .withCode("range_invalid");
    }
    Map<Instant, Map<String, Long>> cells = new HashMap<>();
    for (FeedbackBucketRow row :
        feedbackRepository.countByBucket(
            unit, from, to, submittedAs == null ? null : submittedAs.getValue())) {
      cells
          .computeIfAbsent(Instant.ofEpochSecond(row.getBucketEpoch()), key -> new HashMap<>())
          .merge(row.getCategory(), row.getCount(), Long::sum);
    }
    Map<String, Long> byCategory = zeroes();
    List<FeedbackStatsDto.BucketDto> buckets = new ArrayList<>();
    long total = 0;
    for (Instant start = truncate(from, unit); start.isBefore(to); start = next(start, unit)) {
      Map<String, Long> counts = zeroes();
      Map<String, Long> found = cells.getOrDefault(start, Map.of());
      long bucketTotal = 0;
      for (Map.Entry<String, Long> entry : found.entrySet()) {
        counts.put(entry.getKey(), entry.getValue());
        byCategory.merge(entry.getKey(), entry.getValue(), Long::sum);
        bucketTotal += entry.getValue();
      }
      total += bucketTotal;
      buckets.add(new FeedbackStatsDto.BucketDto(start, bucketTotal, counts));
    }
    return new FeedbackStatsDto(from, to, unit, total, byCategory, buckets);
  }

  /** The UTC bucket start containing the instant (day; ISO week from Monday; calendar month). */
  static Instant truncate(Instant instant, String unit) {
    LocalDate date = instant.atZone(ZoneOffset.UTC).toLocalDate();
    LocalDate start =
        switch (unit) {
          case "week" -> date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
          case "month" -> date.withDayOfMonth(1);
          default -> date;
        };
    return start.atStartOfDay(ZoneOffset.UTC).toInstant();
  }

  static Instant next(Instant start, String unit) {
    ZonedDateTime zoned = start.atZone(ZoneOffset.UTC);
    ZonedDateTime next =
        switch (unit) {
          case "week" -> zoned.plusWeeks(1);
          case "month" -> zoned.plusMonths(1);
          default -> zoned.plusDays(1);
        };
    return next.toInstant();
  }

  private static Map<String, Long> zeroes() {
    Map<String, Long> counts = new LinkedHashMap<>();
    for (FeedbackCategory category : FeedbackCategory.values()) {
      counts.put(category.getValue(), 0L);
    }
    return counts;
  }

  @Override
  public AdminFeedbackDto tag(UUID adminUserId, UUID feedbackId, List<String> tags) {
    Feedback feedback = require(feedbackId);
    Set<String> normalized = new LinkedHashSet<>();
    for (String tag : tags) {
      String cleaned = tag == null ? "" : tag.trim().toLowerCase();
      if (cleaned.isEmpty() || cleaned.length() > MAX_TAG_LENGTH) {
        throw (BusinessRuleViolationException)
            new BusinessRuleViolationException("Tags are 1..30 characters after trimming")
                .withCode("tag_invalid");
      }
      normalized.add(cleaned);
    }
    List<String> before =
        feedbackTagRepository.findByFeedbackIdOrderByTagAsc(feedbackId).stream()
            .map(FeedbackTag::getTag)
            .toList();
    feedbackTagRepository.deleteByFeedbackId(feedbackId);
    feedbackTagRepository.flush();
    Instant now = clock.instant();
    for (String tag : normalized) {
      feedbackTagRepository.save(
          FeedbackTag.builder()
              .feedbackId(feedbackId)
              .tag(tag)
              .taggedBy(adminUserId)
              .createdAt(now)
              .build());
    }
    auditService.record(
        adminUserId,
        "feedback.tag",
        "feedback",
        feedbackId.toString(),
        Map.of("tags", before),
        Map.of("tags", List.copyOf(normalized)));
    return adminViews(List.of(feedback)).get(0);
  }

  private Feedback require(UUID feedbackId) {
    return feedbackRepository
        .findById(feedbackId)
        .orElseThrow(() -> new ResourceNotFoundException("Feedback not found"));
  }

  private List<AdminFeedbackDto> adminViews(List<Feedback> entries) {
    if (entries.isEmpty()) {
      return List.of();
    }
    List<UUID> ids = entries.stream().map(Feedback::getId).toList();
    Map<UUID, List<String>> tags = new HashMap<>();
    for (FeedbackTag tag :
        feedbackTagRepository.findByFeedbackIdInOrderByFeedbackIdAscTagAsc(ids)) {
      tags.computeIfAbsent(tag.getFeedbackId(), key -> new ArrayList<>()).add(tag.getTag());
    }
    Map<UUID, User> users =
        userRepository
            .findAllById(entries.stream().map(Feedback::getUserId).collect(Collectors.toSet()))
            .stream()
            .collect(Collectors.toMap(User::getId, Function.identity()));
    return entries.stream()
        .map(
            entry -> {
              User user = users.get(entry.getUserId());
              return new AdminFeedbackDto(
                  view(entry),
                  new PartySummaryDto(
                      entry.getUserId(),
                      user == null ? "" : user.getName(),
                      entry.getSubmittedAs()),
                  tags.getOrDefault(entry.getId(), List.of()));
            })
        .toList();
  }

  private static FeedbackDto view(Feedback feedback) {
    return new FeedbackDto(
        feedback.getId(),
        feedback.getCategory(),
        feedback.getBody(),
        feedback.getSubmittedAs(),
        feedback.getCreatedAt());
  }
}
