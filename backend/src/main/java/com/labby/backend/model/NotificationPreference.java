package com.labby.backend.model;

import com.labby.backend.enums.NotificationCategory;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.io.Serializable;
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
 * A user's push opt-in for one category (NTF-02). No row = enabled; ride and safety can never be
 * disabled (V7 CHECK).
 */
@Entity
@Table(name = "notification_preferences")
@IdClass(NotificationPreference.Key.class)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class NotificationPreference {

  @Id
  @Column(name = "user_id")
  private UUID userId;

  /**
   * The category's wire value. Kept a String because JPA never applies attribute converters to id
   * attributes; use {@link #category()} for the typed view.
   */
  @Id
  @Column(name = "category", length = 16)
  private String category;

  @Column(name = "enabled", nullable = false)
  private boolean enabled;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @PrePersist
  @PreUpdate
  void touch() {
    updatedAt = Instant.now();
  }

  /**
   * The typed category.
   *
   * @return the category
   */
  public NotificationCategory category() {
    return NotificationCategory.fromValue(category);
  }

  /**
   * Builds the composite key.
   *
   * @param userId the account
   * @param category the category
   * @return the key
   */
  public static Key key(UUID userId, NotificationCategory category) {
    return new Key(userId, category.getValue());
  }

  /**
   * Composite key (user, category wire value).
   *
   * @param userId the account
   * @param category the category wire value
   */
  public record Key(UUID userId, String category) implements Serializable {}

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof NotificationPreference that)) {
      return false;
    }
    return userId != null && userId.equals(that.userId) && Objects.equals(category, that.category);
  }

  @Override
  public int hashCode() {
    return Objects.hash(userId, category);
  }
}
