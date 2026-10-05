package com.labby.backend.security;

import com.labby.backend.enums.Role;
import com.labby.backend.service.PermissionService;
import com.labby.backend.service.SessionService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Resolves a Bearer access token into the SecurityContext. Invalid or absent tokens simply leave
 * the request anonymous; the deny-by-default chain then answers 401. The token's {@code sid} claim
 * is checked against the refresh-token row so a revoked session (logout, password change, delete,
 * reuse-revocation) invalidates its access tokens immediately (UC-S-03), not after the access TTL.
 * For tokens carrying the admin role, the {@code domain:action} authorities of the user's single
 * RBAC role are resolved from the DB on every request (RBAC-02/03): role edits, role changes and
 * admin deactivation apply to the very next call, never cached in the token. Deliberately NOT a
 * {@code @Component}: it is built and registered only inside the security chain, never as a
 * standalone servlet filter.
 */
@RequiredArgsConstructor
public class JwtAuthFilter extends OncePerRequestFilter {

  private static final String BEARER_PREFIX = "Bearer ";

  private final JwtService jwtService;
  private final SessionService sessionService;
  private final PermissionService permissionService;

  @Override
  protected void doFilterInternal(
      @NonNull HttpServletRequest request,
      @NonNull HttpServletResponse response,
      @NonNull FilterChain filterChain)
      throws ServletException, IOException {
    String header = request.getHeader("Authorization");
    if (header != null && header.startsWith(BEARER_PREFIX)) {
      jwtService
          .parseAccessToken(header.substring(BEARER_PREFIX.length()))
          .filter(claims -> sessionService.isSessionLive(claims.sessionId()))
          .ifPresent(
              claims -> {
                List<GrantedAuthority> authorities = new ArrayList<>();
                claims.roles().forEach(role -> authorities.add(new SimpleGrantedAuthority(role)));
                if (claims.roles().contains(Role.ADMIN.getValue())) {
                  permissionService
                      .permissionCodesFor(claims.userId())
                      .forEach(code -> authorities.add(new SimpleGrantedAuthority(code)));
                }
                var authentication =
                    new UsernamePasswordAuthenticationToken(
                        claims.userId().toString(), null, authorities);
                authentication.setDetails(claims);
                SecurityContextHolder.getContext().setAuthentication(authentication);
              });
    }
    filterChain.doFilter(request, response);
  }
}
