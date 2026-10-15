package com.labby.backend.security;

import com.labby.backend.exception.UnauthorizedException;
import java.util.Optional;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/** Access to the authenticated principal set by {@link JwtAuthFilter}. */
public final class SecurityUtils {

  private SecurityUtils() {}

  /**
   * Returns the authenticated account id.
   *
   * @return the user id
   * @throws UnauthorizedException when no authenticated user is present
   */
  public static UUID currentUserId() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication == null
        || !(authentication.getDetails() instanceof JwtService.AccessClaims claims)) {
      throw new UnauthorizedException("Authentication required");
    }
    return claims.userId();
  }

  /**
   * Whether the caller holds a permission — for response shaping inside an endpoint (e.g. contact
   * access: party phones only for {@code support:handle} holders, UC-A-20).
   *
   * @param authentication the caller
   * @param authority the permission code
   * @return true when granted
   */
  public static boolean holds(Authentication authentication, String authority) {
    return authentication != null
        && authentication.getAuthorities().stream()
            .anyMatch(granted -> authority.equals(granted.getAuthority()));
  }

  /**
   * Returns the current session id (the refresh-token row the access token was issued with), used
   * to keep the current session alive when revoking the others (AUTH-05).
   *
   * @return the session id when available
   */
  public static Optional<UUID> currentSessionId() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication != null
        && authentication.getDetails() instanceof JwtService.AccessClaims claims) {
      return Optional.of(claims.sessionId());
    }
    return Optional.empty();
  }
}
