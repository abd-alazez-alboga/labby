package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.Objects;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One localized one-tap quick reply (CHAT-02, NFR-U2). Code-addressed catalog seeded by V15: a
 * message stores the CODE and each client renders its own language, so a language switch re-renders
 * history instantly. {@code audience} is {@code rider}, {@code driver} or {@code both}.
 */
@Entity
@Table(name = "chat_quick_replies")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class ChatQuickReply {

  /** Audience value offered to both parties. */
  public static final String AUDIENCE_BOTH = "both";

  @Id
  @Column(name = "code", length = 40)
  private String code;

  @Column(name = "audience", nullable = false, length = 6)
  private String audience;

  @Column(name = "text_en", nullable = false, length = 100)
  private String textEn;

  @Column(name = "text_ar", nullable = false, length = 100)
  private String textAr;

  @Column(name = "sort_order", nullable = false)
  private int sortOrder;

  @Column(name = "active", nullable = false)
  private boolean active;

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof ChatQuickReply that)) {
      return false;
    }
    return code != null && code.equals(that.code);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(code);
  }
}
