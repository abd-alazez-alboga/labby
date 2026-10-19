package com.labby.backend.repository.projection;

/** One (bucket start, category, count) cell of the feedback trend view (FDBK-01, UC-A-25). */
public interface FeedbackBucketRow {

  /** The bucket start as epoch seconds (UTC). */
  long getBucketEpoch();

  String getCategory();

  long getCount();
}
