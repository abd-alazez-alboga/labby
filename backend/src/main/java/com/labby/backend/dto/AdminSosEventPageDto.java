package com.labby.backend.dto;

import java.util.List;

/**
 * One page of the admin SOS alert list, newest first (UC-A-20).
 *
 * @param items the events
 * @param nextCursor the {@code before} cursor of the next page; null when exhausted
 */
public record AdminSosEventPageDto(List<AdminSosEventDto> items, String nextCursor) {

  /**
   * The same page with every caller phone withheld (no {@code support:handle}).
   *
   * @return the page without phones
   */
  public AdminSosEventPageDto withoutPhones() {
    return new AdminSosEventPageDto(
        items.stream().map(AdminSosEventDto::withoutPhone).toList(), nextCursor);
  }
}
