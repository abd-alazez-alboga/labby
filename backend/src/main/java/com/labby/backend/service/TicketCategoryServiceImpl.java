package com.labby.backend.service;

import com.labby.backend.dto.AdminTicketCategoryDto;
import com.labby.backend.dto.PatchTicketCategoryRequestDto;
import com.labby.backend.dto.SaveTicketCategoryRequestDto;
import com.labby.backend.dto.TicketCategoryDto;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.TicketCategory;
import com.labby.backend.repository.SupportTicketRepository;
import com.labby.backend.repository.TicketCategoryRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Ticket categories (see {@link TicketCategoryService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class TicketCategoryServiceImpl implements TicketCategoryService {

  private static final String TARGET = "ticket_category";

  private final TicketCategoryRepository ticketCategoryRepository;
  private final SupportTicketRepository supportTicketRepository;
  private final AuditService auditService;

  @Override
  @Transactional(readOnly = true)
  public List<TicketCategoryDto> userList() {
    return ticketCategoryRepository.findUserPickable(TicketCategoryCodes.USER_PICKABLE).stream()
        .map(SupportAssembler::category)
        .toList();
  }

  @Override
  @Transactional(readOnly = true)
  public List<AdminTicketCategoryDto> adminList() {
    return ticketCategoryRepository.findAllByOrderBySortOrderAscNameEnAsc().stream()
        .map(this::adminView)
        .toList();
  }

  @Override
  public AdminTicketCategoryDto create(UUID adminUserId, SaveTicketCategoryRequestDto request) {
    requireNames(request.nameEn(), request.nameAr());
    TicketCategory category =
        ticketCategoryRepository.save(
            TicketCategory.builder()
                .nameEn(request.nameEn().trim())
                .nameAr(request.nameAr().trim())
                .defaultPriority(request.defaultPriority())
                .sortOrder(request.sortOrder() == null ? 0 : request.sortOrder())
                .build());
    auditService.record(
        adminUserId,
        "ticket_category.create",
        TARGET,
        category.getId().toString(),
        null,
        state(category));
    return adminView(category);
  }

  @Override
  public AdminTicketCategoryDto patch(
      UUID adminUserId, UUID categoryId, PatchTicketCategoryRequestDto request) {
    TicketCategory category = require(categoryId);
    Map<String, Object> before = state(category);
    if (request.nameEn() != null) {
      requireNames(request.nameEn(), category.getNameAr());
      category.setNameEn(request.nameEn().trim());
    }
    if (request.nameAr() != null) {
      requireNames(category.getNameEn(), request.nameAr());
      category.setNameAr(request.nameAr().trim());
    }
    if (request.defaultPriority() != null) {
      category.setDefaultPriority(request.defaultPriority());
    }
    if (request.sortOrder() != null) {
      category.setSortOrder(request.sortOrder());
    }
    if (request.active() != null) {
      if (category.isSystem() && !request.active()) {
        throw systemCategory();
      }
      category.setActive(request.active());
    }
    ticketCategoryRepository.save(category);
    auditService.record(
        adminUserId,
        "ticket_category.update",
        TARGET,
        categoryId.toString(),
        before,
        state(category));
    return adminView(category);
  }

  @Override
  public void delete(UUID adminUserId, UUID categoryId) {
    TicketCategory category = require(categoryId);
    if (category.isSystem()) {
      throw systemCategory();
    }
    if (supportTicketRepository.existsByTicketCategoryId(categoryId)) {
      throw (ConflictException)
          new ConflictException("Tickets reference this category; deactivate it instead")
              .withCode("category_in_use");
    }
    ticketCategoryRepository.delete(category);
    auditService.record(
        adminUserId,
        "ticket_category.delete",
        TARGET,
        categoryId.toString(),
        state(category),
        null);
  }

  private TicketCategory require(UUID categoryId) {
    return ticketCategoryRepository
        .findById(categoryId)
        .orElseThrow(() -> new ResourceNotFoundException("Ticket category not found"));
  }

  private AdminTicketCategoryDto adminView(TicketCategory category) {
    return new AdminTicketCategoryDto(
        category.getId(),
        category.getSystemCode(),
        category.getNameEn(),
        category.getNameAr(),
        category.getDefaultPriority(),
        category.getSortOrder(),
        category.isActive(),
        supportTicketRepository.countByTicketCategoryId(category.getId()),
        category.getCreatedAt(),
        category.getUpdatedAt());
  }

  private static void requireNames(String nameEn, String nameAr) {
    if (nameEn == null || nameEn.isBlank() || nameAr == null || nameAr.isBlank()) {
      throw (BusinessRuleViolationException)
          new BusinessRuleViolationException("A name in both languages is required")
              .withCode("name_required");
    }
  }

  private static ConflictException systemCategory() {
    return (ConflictException)
        new ConflictException("System ticket categories stay active and permanent")
            .withCode("system_category");
  }

  private static Map<String, Object> state(TicketCategory category) {
    Map<String, Object> state = new LinkedHashMap<>();
    state.put("nameEn", category.getNameEn());
    state.put("nameAr", category.getNameAr());
    state.put("defaultPriority", category.getDefaultPriority().getValue());
    state.put("sortOrder", category.getSortOrder());
    state.put("active", category.isActive());
    return state;
  }
}
