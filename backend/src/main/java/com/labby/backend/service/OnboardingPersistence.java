package com.labby.backend.service;

import com.labby.backend.exception.ConflictException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Flush-now writes for the onboarding flows. Flushing inside the service method makes the
 * database's race guards surface where they can be translated: a unique-index violation from a
 * concurrent submission (one open vehicle / one open document per slot / one profile per account)
 * becomes 409, and the optimistic {@code @Version} check of the FIRST flushed row serializes
 * concurrent decisions (the loser's {@code OptimisticLockingFailureException} maps to 409).
 */
final class OnboardingPersistence {

  private OnboardingPersistence() {}

  /**
   * Saves and flushes, translating constraint violations into 409.
   *
   * @param repository the repository
   * @param entity the entity
   * @param conflictMessage the 409 message on a constraint violation
   * @param <T> the entity type
   * @return the managed entity
   */
  static <T> T saveAndFlush(JpaRepository<T, ?> repository, T entity, String conflictMessage) {
    try {
      return repository.saveAndFlush(entity);
    } catch (DataIntegrityViolationException ex) {
      throw new ConflictException(conflictMessage);
    }
  }
}
