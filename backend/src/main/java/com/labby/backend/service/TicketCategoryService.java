package com.labby.backend.service;

import com.labby.backend.dto.AdminTicketCategoryDto;
import com.labby.backend.dto.PatchTicketCategoryRequestDto;
import com.labby.backend.dto.SaveTicketCategoryRequestDto;
import com.labby.backend.dto.TicketCategoryDto;
import java.util.List;
import java.util.UUID;

/** Ticket categories (SUP-01/03, UC-A-24): the user-pickable list and the admin CRUD. */
public interface TicketCategoryService {

  /**
   * The active categories a user may pick, in order — never the system lost-item one.
   *
   * @return the list
   */
  List<TicketCategoryDto> userList();

  /**
   * Every category, inactive and system ones included, in order.
   *
   * @return the list
   */
  List<AdminTicketCategoryDto> adminList();

  /**
   * Creates a category (audited {@code ticket_category.create}).
   *
   * @param adminUserId the acting admin
   * @param request names, default priority, order
   * @return the created category
   */
  AdminTicketCategoryDto create(UUID adminUserId, SaveTicketCategoryRequestDto request);

  /**
   * Edits names, default priority, order or the active flag (audited {@code
   * ticket_category.update}); existing tickets keep theirs. The system row refuses {@code active:
   * false} (409 {@code system_category}).
   *
   * @param adminUserId the acting admin
   * @param categoryId the category
   * @param request the fields to change
   * @return the updated category
   */
  AdminTicketCategoryDto patch(
      UUID adminUserId, UUID categoryId, PatchTicketCategoryRequestDto request);

  /**
   * Deletes an unused category (audited {@code ticket_category.delete}); 409 {@code
   * category_in_use} when a ticket references it, {@code system_category} on the system row.
   *
   * @param adminUserId the acting admin
   * @param categoryId the category
   */
  void delete(UUID adminUserId, UUID categoryId);
}
