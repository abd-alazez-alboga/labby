package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * The failed-login counter of one phone + client IP pair (NFR-S3, V32), written only through {@code
 * LoginFailureRepository#recordFailure}: the failures counted since {@code windowStart}.
 */
@Entity
@Table(name = "login_failures")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class LoginFailure {

  @Id
  @Column(name = "login_failure_id")
  private UUID id;

  @Column(name = "phone", nullable = false, length = 20)
  private String phone;

  @Column(name = "client_ip", nullable = false)
  private String clientIp;

  @Column(name = "window_start", nullable = false)
  private Instant windowStart;

  @Column(name = "failures", nullable = false)
  private int failures;

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof LoginFailure that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
