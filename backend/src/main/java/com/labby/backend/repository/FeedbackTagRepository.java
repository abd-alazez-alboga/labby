package com.labby.backend.repository;

import com.labby.backend.model.FeedbackTag;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Admin tags on feedback entries (UC-A-25, V26). */
public interface FeedbackTagRepository extends JpaRepository<FeedbackTag, FeedbackTag.Key> {

  List<FeedbackTag> findByFeedbackIdOrderByTagAsc(UUID feedbackId);

  List<FeedbackTag> findByFeedbackIdInOrderByFeedbackIdAscTagAsc(Collection<UUID> feedbackIds);

  void deleteByFeedbackId(UUID feedbackId);
}
