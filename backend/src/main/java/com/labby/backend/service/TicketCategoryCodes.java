package com.labby.backend.service;

import java.util.Set;

/**
 * The {@code system_code}s of the seeded, protected ticket categories (never deactivated nor
 * deleted — V26 trigger). Most are opened by the system only ({@code lost_item}); the ones in
 * {@link #USER_PICKABLE} are also offered to users in the category picker, where the apps find them
 * by code (review V1 W39: the suspended screen's "Contact support" pre-selects {@link
 * #ACCOUNT_SUSPEND}).
 */
public final class TicketCategoryCodes {

  /** "Account &amp; suspension" (V36, review V1 W39): a user-pickable system category. */
  public static final String ACCOUNT_SUSPEND = "account_suspend";

  /** The system categories users may pick when opening a ticket. */
  public static final Set<String> USER_PICKABLE = Set.of(ACCOUNT_SUSPEND);

  private TicketCategoryCodes() {}

  /**
   * Whether a category with this code may be picked by a user.
   *
   * @param systemCode the category's system code, null for an admin-made category
   * @return true for admin-made categories and the user-pickable system ones
   */
  public static boolean userPickable(String systemCode) {
    return systemCode == null || USER_PICKABLE.contains(systemCode);
  }
}
