package com.labby.backend.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/** Replace an entry's tags; trimmed and lower-cased server-side, duplicates collapse. */
public record FeedbackTagsRequestDto(@NotNull @Size(max = 10) List<String> tags) {}
