package com.labby.backend.repository;

import com.labby.backend.enums.OtpPurpose;
import com.labby.backend.model.OtpCode;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Hashed one-time codes (AUTH-04). */
public interface OtpCodeRepository extends JpaRepository<OtpCode, UUID> {

  Optional<OtpCode> findTopByPhoneAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(
      String phone, OtpPurpose purpose);

  Optional<OtpCode> findTopByPhoneAndPurposeOrderByCreatedAtDesc(String phone, OtpPurpose purpose);

  long countByPhoneAndCreatedAtAfter(String phone, Instant after);
}
