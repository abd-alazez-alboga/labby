package com.labby.backend.service;

/**
 * The daily document-expiry pass (DRV-04): 30- and 7-day reminders (each once per document) and
 * auto-suspension of drivers whose current document has expired. Runs on the application clock in
 * the operating timezone, so tests drive it on a controlled clock.
 */
public interface DocumentExpiryService {

  /**
   * Runs one pass over the approved current documents of approved drivers: the ID/licence and the
   * ACTIVE vehicle's registration/insurance. A document is valid THROUGH its {@code expiresOn}.
   * Reminders: {@code document.expiry_reminder} with {@code daysLeft} 30 once the document is
   * within 30 days, 7 once within 7 days (each at most once; a document first seen inside 7 days
   * only gets the 7-day one). Expired → the ACTIVE driver role is suspended with {@code
   * document_expired} ({@code driver.suspended}); suspensions for other reasons stay untouched.
   */
  void runExpiryCheck();
}
