package com.labby.backend.security;

import com.labby.backend.service.SessionService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Resolves a Bearer access token into the SecurityContext. Invalid or absent tokens simply leave
 * the request anonymous; the deny-by-default chain then answers 401. The token's {@code sid} claim
 * is checked against the refresh-token row so a revoked session (logout, password change, delete,
 * reuse-revocation) invalidates its access tokens immediately (UC-S-03), not after the access TTL.
 * Deliberately NOT a {@code @Component}: it is built and registered only inside the security chain,
 * never as a standalone servlet filter.
 */
@RequiredArgsConstructor
public class JwtAuthFilter extends OncePerRequestFilter {

  private static final String BEARER_PREFIX = "Bearer ";

  private final JwtService jwtService;
  private final SessionService sessionService;

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
                var authorities = claims.roles().stream().map(SimpleGrantedAuthority::new).toList();
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
