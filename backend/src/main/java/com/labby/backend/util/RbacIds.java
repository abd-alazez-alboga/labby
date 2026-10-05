package com.labby.backend.util;

import java.util.UUID;

/** Fixed ids of the system roles seeded by V4 (referenced by seeder, services, and tests). */
public final class RbacIds {

  public static final UUID SUPER_ADMIN_ROLE_ID =
      UUID.fromString("00000000-0000-0000-0000-000000000001");
  public static final UUID SUPPORT_ROLE_ID =
      UUID.fromString("00000000-0000-0000-0000-000000000002");

  private RbacIds() {}
}
