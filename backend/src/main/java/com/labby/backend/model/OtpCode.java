package com.labby.backend.model;

import com.labby.backend.enums.OtpPurpose;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
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
 * One-time code, stored HASHED and bound to the purpose it was issued for (AUTH-04). The plain code
 * exists only in the SMS — it is never persisted, logged, or returned by the API.
 */
@Entity
@Table(name = "otp_codes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class OtpCode {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "otp_code_id")
  private UUID id;

  @Column(name = "phone", nullable = false, length = 20)
  private String phone;

  @Column(name = "code_hash", nullable = false)
  private String codeHash;

  @Column(name = "purpose", nullable = false, length = 16)
  private OtpPurpose purpose;

  @Column(name = "expires_at", nullable = false)
  private Instant expiresAt;

  @Builder.Default
  @Column(name = "attempts", nullable = false)
  private int attempts = 0;

  @Column(name = "consumed_at")
  private Instant consumedAt;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    if (createdAt == null) {
      createdAt = Instant.now();
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof OtpCode that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
