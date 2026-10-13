package com.labby.backend.repository;

import com.labby.backend.model.ChatQuickReply;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** The seeded quick-reply catalog (CHAT-02). */
public interface ChatQuickReplyRepository extends JpaRepository<ChatQuickReply, String> {

  List<ChatQuickReply> findByActiveTrueAndAudienceInOrderBySortOrderAscCodeAsc(
      Collection<String> audiences);

  Optional<ChatQuickReply> findByCodeAndActiveTrue(String code);
}
