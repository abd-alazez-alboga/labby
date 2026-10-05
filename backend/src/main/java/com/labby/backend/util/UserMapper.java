package com.labby.backend.util;

import com.labby.backend.dto.RoleAssignmentDto;
import com.labby.backend.dto.UserProfileDto;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.model.User;
import java.util.List;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

/**
 * Maps {@link User} and its {@link RoleAssignment}s to the API profile DTO. RBAC enrichment of the
 * admin assignment (rbacRole + permissions) is data-dependent and lives in {@code ProfileService}.
 */
@Mapper
public interface UserMapper {

  @Mapping(target = "rbacRole", ignore = true)
  @Mapping(target = "permissions", ignore = true)
  RoleAssignmentDto toRoleAssignmentDto(RoleAssignment roleAssignment);

  List<RoleAssignmentDto> toRoleAssignmentDtos(List<RoleAssignment> roleAssignments);

  /**
   * Builds the profile DTO from prebuilt role DTOs. The photo URL is the permission-checked serving
   * endpoint — never the storage path (NFR-S2).
   *
   * @param user the account
   * @param roles the account's role assignment DTOs
   * @return the profile DTO
   */
  @Mapping(target = "id", source = "user.id")
  @Mapping(target = "photoUrl", expression = "java(toPhotoUrl(user))")
  UserProfileDto toProfileDto(User user, List<RoleAssignmentDto> roles);

  /**
   * Derives the private photo URL from the presence of a stored photo.
   *
   * @param user the account
   * @return the serving path, or null when no photo is stored
   */
  default String toPhotoUrl(User user) {
    return user.getPhotoPath() == null ? null : "/api/v1/users/me/photo";
  }
}
