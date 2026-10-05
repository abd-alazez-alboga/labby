package com.labby.backend.service;

import com.labby.backend.repository.RbacPermissionRepository;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** DB-backed per-request permission resolution (see {@link PermissionService}). */
@Service
@RequiredArgsConstructor
public class PermissionServiceImpl implements PermissionService {

  private final RbacPermissionRepository rbacPermissionRepository;

  @Override
  @Transactional(readOnly = true)
  public List<String> permissionCodesFor(UUID userId) {
    return rbacPermissionRepository.findCodesForActiveAdmin(userId);
  }
}
