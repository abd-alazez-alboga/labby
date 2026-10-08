package com.labby.backend.model;

import com.labby.backend.enums.ComfortConversation;
import com.labby.backend.enums.ComfortMusic;
import com.labby.backend.enums.ComfortTemperature;
import com.labby.backend.enums.PickupDistanceMode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
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
 * Rider extras (USR-03): comfort preferences shown to the driver (UC-R-02) and the matching toggle
 * applied to dispatch (UC-R-03). No row means every default.
 */
@Entity
@Table(name = "rider_preferences")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class RiderPreference {

  @Id
  @Column(name = "user_id")
  private UUID userId;

  @Builder.Default
  @Column(name = "temperature", nullable = false, length = 16)
  private ComfortTemperature temperature = ComfortTemperature.NO_PREFERENCE;

  @Builder.Default
  @Column(name = "conversation", nullable = false, length = 16)
  private ComfortConversation conversation = ComfortConversation.NO_PREFERENCE;

  @Builder.Default
  @Column(name = "music", nullable = false, length = 16)
  private ComfortMusic music = ComfortMusic.NO_PREFERENCE;

  @Builder.Default
  @Column(name = "pickup_distance_mode", nullable = false, length = 20)
  private PickupDistanceMode pickupDistanceMode = PickupDistanceMode.NEARBY_ONLY;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  /**
   * The defaults a rider without a row has.
   *
   * @param userId the rider
   * @return an unsaved row with every default
   */
  public static RiderPreference defaults(UUID userId) {
    return RiderPreference.builder().userId(userId).build();
  }

  @PrePersist
  @PreUpdate
  void touch() {
    updatedAt = Instant.now();
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof RiderPreference that)) {
      return false;
    }
    return userId != null && userId.equals(that.userId);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(userId);
  }
}
