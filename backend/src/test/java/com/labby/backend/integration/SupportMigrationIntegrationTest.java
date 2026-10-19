package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * M14-T1 acceptance: V26 migrates cleanly and the support invariants hold at the DATABASE level —
 * the seeded, protected lost-item category and the priority scale (SUP-01/03); the two state
 * machines' shapes, a lost-item case being exactly a ticket with a ride whose closure closes the
 * ticket, one open case per rider per ride (LOST-01/02), one ticket per SOS event; attachment and
 * thread/event shapes (SUP-02); publishing a help article with any language missing being
 * impossible (SUP-04, milestone AC); the feedback catalog and tag shape (FDBK-01); the new
 * content:* permissions granted to Super Admin only.
 */
class SupportMigrationIntegrationTest extends AbstractIntegrationTest {

  private static final String LOST_ITEM_CATEGORY = "00000000-0000-0000-0000-000000001401";

  @Autowired private JdbcTemplate jdbcTemplate;

  private final List<UUID> createdUsers = new ArrayList<>();
  private UUID regionId;
  private UUID serviceTypeId;
  private UUID admin;
  private UUID rider;
  private UUID driver;
  private UUID category;

  @BeforeEach
  void seedRegionAndParties() {
    regionId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO regions (region_id, name, currency) VALUES (?, ?, 'SYP')",
        regionId,
        "Support IT " + regionId);
    serviceTypeId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO service_types (service_type_id, region_id, name_en, name_ar, base_fare,"
            + " per_km_rate, per_min_rate, minimum_fare) VALUES (?, ?, 'Economy', 'اقتصادي', 1.00,"
            + " 0.30, 0.05, 1.50)",
        serviceTypeId,
        regionId);
    admin = newUser();
    rider = newUser();
    driver = newUser();
    category = insertCategory("Payments", "المدفوعات", "normal");
  }

  @AfterEach
  void cleanOwnRows() {
    // sos_events are permanent by trigger; TRUNCATE bypasses row-level triggers (as the comms
    // test does) and must name every table that references the truncated ones.
    jdbcTemplate.execute(
        "TRUNCATE ticket_attachments, ticket_messages, ticket_events, support_tickets, sos_events,"
            + " feedback_tags, feedback, help_articles, help_categories");
    jdbcTemplate.execute("DELETE FROM ticket_categories WHERE system_code IS NULL");
    jdbcTemplate.update("DELETE FROM rides WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM service_types WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM regions WHERE region_id = ?", regionId);
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM stored_files WHERE owner_user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM users WHERE user_id = ?", userId);
    }
    createdUsers.clear();
  }

  @Test
  @DisplayName(
      "SUP-01/03: the lost-item system category is seeded high and can neither be deactivated nor deleted")
  void shouldSeedAndProtectTheLostItemCategory() {
    assertThat(
            jdbcTemplate.queryForMap(
                "SELECT system_code, name_en, name_ar, default_priority, active FROM"
                    + " ticket_categories WHERE ticket_category_id = ?::uuid",
                LOST_ITEM_CATEGORY))
        .containsEntry("system_code", "lost_item")
        .containsEntry("name_en", "Lost item")
        .containsEntry("name_ar", "مفقودات")
        .containsEntry("default_priority", "high")
        .containsEntry("active", true);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE ticket_categories SET active = FALSE WHERE ticket_category_id = ?::uuid",
                    LOST_ITEM_CATEGORY))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("system ticket categories stay active");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "DELETE FROM ticket_categories WHERE ticket_category_id = ?::uuid",
                    LOST_ITEM_CATEGORY))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("system ticket categories are permanent");
    // Names and order stay editable; an ordinary category deactivates and deletes freely.
    jdbcTemplate.update(
        "UPDATE ticket_categories SET name_en = 'Lost items', sort_order = 5 WHERE"
            + " ticket_category_id = ?::uuid",
        LOST_ITEM_CATEGORY);
    jdbcTemplate.update(
        "UPDATE ticket_categories SET name_en = 'Lost item', sort_order = 1000 WHERE"
            + " ticket_category_id = ?::uuid",
        LOST_ITEM_CATEGORY);
    jdbcTemplate.update(
        "UPDATE ticket_categories SET active = FALSE WHERE ticket_category_id = ?", category);
    jdbcTemplate.update("DELETE FROM ticket_categories WHERE ticket_category_id = ?", category);
    // The priority scale is the owner's four levels.
    assertThatThrownBy(() -> insertCategory("Bad", "سيء", "medium"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ticket_categories_priority");
    assertThatThrownBy(() -> insertCategory("  ", "فارغ", "low"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ticket_categories_names");
  }

  @Test
  @DisplayName(
      "SUP-02/03: ticket shape — status and priority scales, closed/waiting stamps, priority rank")
  void shouldEnforceTicketShape() {
    UUID ticket = insertTicket(rider, category, "normal", null);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE support_tickets SET status = 'pending' WHERE support_ticket_id = ?",
                    ticket))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_status");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE support_tickets SET priority = 'medium' WHERE support_ticket_id = ?",
                    ticket))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_priority");
    // closed needs its moment; resolved/closed need resolved_at; waiting_on_user needs
    // waiting_since.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE support_tickets SET status = 'closed' WHERE support_ticket_id = ?",
                    ticket))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_closed");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE support_tickets SET status = 'resolved' WHERE support_ticket_id = ?",
                    ticket))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_resolved");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE support_tickets SET status = 'waiting_on_user' WHERE support_ticket_id = ?",
                    ticket))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_waiting");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE support_tickets SET reminder_sent_at = now() WHERE support_ticket_id = ?",
                    ticket))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_reminder");
    jdbcTemplate.update(
        "UPDATE support_tickets SET status = 'waiting_on_user', waiting_since = now(),"
            + " reminder_sent_at = now() WHERE support_ticket_id = ?",
        ticket);
    jdbcTemplate.update(
        "UPDATE support_tickets SET status = 'resolved', waiting_since = NULL,"
            + " reminder_sent_at = NULL, resolved_at = now() WHERE support_ticket_id = ?",
        ticket);
    jdbcTemplate.update(
        "UPDATE support_tickets SET status = 'closed', closed_at = now() WHERE support_ticket_id = ?",
        ticket);
    // A plain ticket never carries a case status; a blank description is refused.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE support_tickets SET case_status = 'reported' WHERE support_ticket_id = ?",
                    ticket))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_case_kind");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE support_tickets SET description = '   ' WHERE support_ticket_id = ?",
                    ticket))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_description");
    // The queue order (SUP-03): urgent 0 .. low 3, stored, so priority+age is one index walk.
    UUID low = insertTicket(rider, category, "low", null);
    UUID urgent = insertTicket(rider, category, "urgent", null);
    UUID high = insertTicket(rider, category, "high", null);
    List<UUID> queue =
        jdbcTemplate.queryForList(
            "SELECT support_ticket_id FROM support_tickets WHERE status <> 'closed' ORDER BY"
                + " priority_rank, created_at",
            UUID.class);
    assertThat(queue).containsExactly(urgent, high, low);
  }

  @Test
  @DisplayName(
      "LOST-01/02: a case is a lost-item ticket with a ride; one open case per rider per ride; closing is coupled")
  void shouldEnforceLostItemCaseShape() {
    UUID ride = insertRide(rider);
    // kind and case_status come together, and a case names its ride.
    assertThatThrownBy(() -> insertCase(rider, ride, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_case_kind");
    assertThatThrownBy(() -> insertCase(rider, null, "reported"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_case_ride");
    assertThatThrownBy(() -> insertCase(rider, ride, "lost"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_case_status");
    UUID first = insertCase(rider, ride, "reported");
    // One OPEN case per rider per ride — the index the chat window is derived from.
    assertThatThrownBy(() -> insertCase(rider, ride, "reported"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_support_tickets_open_case");
    // Another rider (a shared-ride member) on the same ride is a different thread, allowed.
    UUID member = newUser();
    insertCase(member, ride, "reported");
    // The case closes only together with its ticket, and vice versa.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE support_tickets SET case_status = 'closed' WHERE support_ticket_id = ?",
                    first))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_case_closed");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE support_tickets SET status = 'closed', closed_at = now(), resolved_at"
                        + " = now() WHERE support_ticket_id = ?",
                    first))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_case_closed");
    jdbcTemplate.update(
        "UPDATE support_tickets SET case_status = 'returned', status = 'resolved', resolved_at ="
            + " now() WHERE support_ticket_id = ?",
        first);
    jdbcTemplate.update(
        "UPDATE support_tickets SET case_status = 'closed', status = 'closed', closed_at = now()"
            + " WHERE support_ticket_id = ?",
        first);
    // Once closed, the rider may report again on the same ride.
    insertCase(rider, ride, "reported");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM support_tickets WHERE ride_id = ? AND user_id = ? AND kind ="
                    + " 'lost_item' AND status <> 'closed'",
                Integer.class,
                ride,
                rider))
        .isEqualTo(1);
  }

  @Test
  @DisplayName(
      "SAFE-01 → SUP: one linked ticket per SOS event, about the SOS ride; the event row keeps its facts")
  void shouldLinkAtMostOneTicketPerSosEvent() {
    UUID ride = insertRide(rider);
    UUID sos = insertSos(ride, rider);
    assertThatThrownBy(() -> insertSosTicket(rider, admin, sos, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_support_tickets_sos_ride");
    insertSosTicket(rider, admin, sos, ride);
    assertThatThrownBy(() -> insertSosTicket(rider, admin, sos, ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_support_tickets_sos_event");
    // The V15 permanence trigger is untouched: the event is still undeletable.
    assertThatThrownBy(
            () -> jdbcTemplate.update("DELETE FROM sos_events WHERE sos_event_id = ?", sos))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("sos_events rows are permanent");
  }

  @Test
  @DisplayName(
      "SUP-01: attachment kinds — PDFs for ticket attachments only, 1..5 positions, a file attached once")
  void shouldEnforceAttachmentShape() {
    UUID ticket = insertTicket(rider, category, "normal", null);
    UUID pdf = insertFile(rider, "ticket_attachment", "application/pdf");
    insertFile(rider, "lost_item_photo", "image/jpeg");
    assertThatThrownBy(() -> insertFile(rider, "lost_item_photo", "application/pdf"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_stored_files_pdf_documents_only");
    assertThatThrownBy(() -> insertFile(rider, "ticket_photo", "image/jpeg"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_stored_files_kind");
    // The pre-M14 kinds and rules are preserved.
    insertFile(rider, "document", "application/pdf");
    assertThatThrownBy(() -> insertFile(rider, "report_photo", "application/pdf"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_stored_files_pdf_documents_only");
    jdbcTemplate.update(
        "INSERT INTO ticket_attachments (support_ticket_id, stored_file_id, position) VALUES"
            + " (?, ?, 1)",
        ticket,
        pdf);
    UUID other = insertTicket(rider, category, "normal", null);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO ticket_attachments (support_ticket_id, stored_file_id, position)"
                        + " VALUES (?, ?, 1)",
                    other,
                    pdf))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_ticket_attachments_file");
    UUID sixth = insertFile(rider, "ticket_attachment", "image/png");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO ticket_attachments (support_ticket_id, stored_file_id, position)"
                        + " VALUES (?, ?, 6)",
                    ticket,
                    sixth))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ticket_attachments_position");
  }

  @Test
  @DisplayName(
      "SUP-02: thread messages have a side and a body; history events carry actor and values")
  void shouldEnforceThreadAndHistoryShape() {
    UUID ticket = insertTicket(rider, category, "normal", null);
    insertMessage(ticket, rider, "user", "Hello");
    insertMessage(ticket, admin, "support", "Hi, looking into it");
    assertThatThrownBy(() -> insertMessage(ticket, admin, "admin", "x"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ticket_messages_side");
    assertThatThrownBy(() -> insertMessage(ticket, rider, "user", "   "))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ticket_messages_body");
    insertEvent(ticket, "status_changed", "support", admin, "open", "in_progress");
    insertEvent(ticket, "reminder_sent", "system", null, null, null);
    insertEvent(ticket, "assigned", "support", admin, null, admin.toString());
    // A change event names both values; a system event has no actor and a human one has.
    assertThatThrownBy(
            () -> insertEvent(ticket, "status_changed", "support", admin, null, "closed"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ticket_events_values");
    assertThatThrownBy(() -> insertEvent(ticket, "reminder_sent", "system", admin, null, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ticket_events_actor");
    assertThatThrownBy(() -> insertEvent(ticket, "created", "user", null, null, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ticket_events_actor");
    assertThatThrownBy(() -> insertEvent(ticket, "escalated", "support", admin, null, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ticket_events_type");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM ticket_events WHERE support_ticket_id = ?",
                Integer.class,
                ticket))
        .isEqualTo(3);
  }

  @Test
  @DisplayName("SUP-04: a help article cannot be published with any of its four texts missing")
  void shouldRefuseHalfTranslatedPublishing() {
    UUID helpCategory = insertHelpCategory("Payments", "المدفوعات");
    UUID article = insertArticle(helpCategory, "How do I pay?", null, "Cash or wallet.", null);
    // A draft may be half-written, but needs a working title in some language.
    assertThatThrownBy(() -> insertArticle(helpCategory, null, "  ", "body", "نص"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_help_articles_working_title");
    // Publishing needs all four texts, and the moment.
    assertThatThrownBy(() -> publish(article))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_help_articles_published_complete");
    jdbcTemplate.update(
        "UPDATE help_articles SET title_ar = 'كيف أدفع؟' WHERE help_article_id = ?", article);
    assertThatThrownBy(() -> publish(article))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_help_articles_published_complete");
    jdbcTemplate.update(
        "UPDATE help_articles SET body_ar = 'نقداً أو من المحفظة.' WHERE help_article_id = ?",
        article);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE help_articles SET status = 'published' WHERE help_article_id = ?",
                    article))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_help_articles_published_at");
    publish(article);
    // Blanking a text of a published article is refused too (edit path, UC-A-23 E1).
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE help_articles SET body_en = '' WHERE help_article_id = ?", article))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_help_articles_published_complete");
    // Bodies are capped at 20,000 characters (owner ruling).
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE help_articles SET body_en = repeat('x', 20001) WHERE help_article_id = ?",
                    article))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_help_articles_body_length");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE help_articles SET status = 'archived' WHERE help_article_id = ?",
                    insertArticle(helpCategory, "Draft", null, null, null)))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_help_articles_status");
    // A category with articles cannot be deleted.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "DELETE FROM help_categories WHERE help_category_id = ?", helpCategory))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("help_articles_help_category_id_fkey");
  }

  @Test
  @DisplayName(
      "FDBK-01: fixed category catalog, submitting app recorded, tags trimmed lower-case and unique per entry")
  void shouldEnforceFeedbackShape() {
    UUID feedback = insertFeedback(rider, "rider", "pricing", "Too expensive at night");
    assertThatThrownBy(() -> insertFeedback(rider, "rider", "billing", "x"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_feedback_category");
    assertThatThrownBy(() -> insertFeedback(rider, "admin", "other", "x"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_feedback_submitted_as");
    assertThatThrownBy(() -> insertFeedback(rider, "driver", "other", " "))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_feedback_body");
    insertTag(feedback, "night-surge");
    insertTag(feedback, "تسعير");
    assertThatThrownBy(() -> insertTag(feedback, "night-surge"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("feedback_tags_pkey");
    assertThatThrownBy(() -> insertTag(feedback, "Night"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_feedback_tags_shape");
    assertThatThrownBy(() -> insertTag(feedback, " padded"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_feedback_tags_shape");
  }

  @Test
  @DisplayName(
      "RBAC: content:view / content:manage exist, Super Admin holds them, Support does not")
  void shouldSeedContentPermissions() {
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT code FROM permissions WHERE domain = 'content' ORDER BY code",
                String.class))
        .containsExactly("content:manage", "content:view");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM role_permissions rp JOIN roles r ON r.role_id = rp.role_id"
                    + " JOIN permissions p ON p.permission_id = rp.permission_id WHERE r.name ="
                    + " 'Super Admin' AND p.domain = 'content'",
                Integer.class))
        .isEqualTo(2);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM role_permissions rp JOIN roles r ON r.role_id = rp.role_id"
                    + " JOIN permissions p ON p.permission_id = rp.permission_id WHERE r.name ="
                    + " 'Support' AND p.domain = 'content'",
                Integer.class))
        .isZero();
  }

  private UUID insertCategory(String nameEn, String nameAr, String priority) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO ticket_categories (ticket_category_id, name_en, name_ar, default_priority)"
            + " VALUES (?, ?, ?, ?)",
        id,
        nameEn,
        nameAr,
        priority);
    return id;
  }

  private UUID insertTicket(UUID userId, UUID categoryId, String priority, UUID rideId) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO support_tickets (support_ticket_id, user_id, ticket_category_id, priority,"
            + " description, ride_id, opened_by_user_id, submitted_as)"
            + " VALUES (?, ?, ?, ?, 'Charged twice', ?, ?, 'rider')",
        id,
        userId,
        categoryId,
        priority,
        rideId,
        userId);
    return id;
  }

  private UUID insertCase(UUID userId, UUID rideId, String caseStatus) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO support_tickets (support_ticket_id, user_id, kind, ticket_category_id,"
            + " priority, case_status, description, ride_id, opened_by_user_id, submitted_as)"
            + " VALUES (?, ?, 'lost_item', ?::uuid, 'high', ?, 'Black umbrella on the back seat', ?,"
            + " ?, 'rider')",
        id,
        userId,
        LOST_ITEM_CATEGORY,
        caseStatus,
        rideId,
        userId);
    return id;
  }

  private UUID insertSosTicket(UUID userId, UUID adminId, UUID sosEventId, UUID rideId) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO support_tickets (support_ticket_id, user_id, ticket_category_id, priority,"
            + " status, description, ride_id, opened_by_user_id, sos_event_id, assignee_user_id,"
            + " submitted_as) VALUES (?, ?, ?, 'urgent', 'in_progress', 'SOS follow-up', ?, ?, ?, ?,"
            + " 'rider')",
        id,
        userId,
        category,
        rideId,
        adminId,
        sosEventId,
        adminId);
    return id;
  }

  private UUID insertSos(UUID rideId, UUID userId) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO sos_events (sos_event_id, ride_id, triggered_by_user_id, triggered_by_role,"
            + " location, triggered_at) VALUES (?, ?, ?, 'rider',"
            + " ST_SetSRID(ST_MakePoint(36.29, 33.51), 4326), now())",
        id,
        rideId,
        userId);
    return id;
  }

  private UUID insertFile(UUID owner, String kind, String contentType) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO stored_files (stored_file_id, owner_user_id, kind, storage_key, content_type,"
            + " size_bytes) VALUES (?, ?, ?, ?, ?, 1024)",
        id,
        owner,
        kind,
        "support-it/" + id,
        contentType);
    return id;
  }

  private void insertMessage(UUID ticket, UUID sender, String side, String body) {
    jdbcTemplate.update(
        "INSERT INTO ticket_messages (support_ticket_id, sender_user_id, sender_side, body) VALUES"
            + " (?, ?, ?, ?)",
        ticket,
        sender,
        side,
        body);
  }

  private void insertEvent(
      UUID ticket, String type, String actorSide, UUID actor, String from, String to) {
    jdbcTemplate.update(
        "INSERT INTO ticket_events (support_ticket_id, type, actor_side, actor_user_id, from_value,"
            + " to_value) VALUES (?, ?, ?, ?, ?, ?)",
        ticket,
        type,
        actorSide,
        actor,
        from,
        to);
  }

  private UUID insertHelpCategory(String nameEn, String nameAr) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO help_categories (help_category_id, name_en, name_ar) VALUES (?, ?, ?)",
        id,
        nameEn,
        nameAr);
    return id;
  }

  private UUID insertArticle(
      UUID helpCategory, String titleEn, String titleAr, String bodyEn, String bodyAr) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO help_articles (help_article_id, help_category_id, title_en, title_ar, body_en,"
            + " body_ar, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        helpCategory,
        titleEn,
        titleAr,
        bodyEn,
        bodyAr,
        admin,
        admin);
    return id;
  }

  private void publish(UUID article) {
    jdbcTemplate.update(
        "UPDATE help_articles SET status = 'published', published_at = now() WHERE help_article_id"
            + " = ?",
        article);
  }

  private UUID insertFeedback(UUID userId, String submittedAs, String category, String body) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO feedback (feedback_id, user_id, submitted_as, category, body) VALUES"
            + " (?, ?, ?, ?, ?)",
        id,
        userId,
        submittedAs,
        category,
        body);
    return id;
  }

  private void insertTag(UUID feedback, String tag) {
    jdbcTemplate.update(
        "INSERT INTO feedback_tags (feedback_id, tag, tagged_by) VALUES (?, ?, ?)",
        feedback,
        tag,
        admin);
  }

  private UUID insertRide(UUID riderId) {
    UUID rideId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO rides (ride_id, rider_user_id, region_id, service_type_id, kind, state,"
            + " pickup, destination, payment_method, pickup_distance_mode, currency,"
            + " estimate_total, estimate_distance_m, estimate_duration_s, estimate_components)"
            + " VALUES (?, ?, ?, ?, 'on_demand', 'requested',"
            + " ST_SetSRID(ST_MakePoint(36.28, 33.50), 4326),"
            + " ST_SetSRID(ST_MakePoint(36.30, 33.52), 4326), 'cash', 'nearby_only', 'SYP',"
            + " 3000.00, 5000, 600, '{}')",
        rideId,
        riderId,
        regionId,
        serviceTypeId);
    return rideId;
  }

  private UUID newUser() {
    UUID userId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'Support Test User', now())",
        userId,
        "+9637%08d".formatted(Math.floorMod(userId.getMostSignificantBits(), 100_000_000L)));
    createdUsers.add(userId);
    return userId;
  }
}
