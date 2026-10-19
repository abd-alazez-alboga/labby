-- M14 Support & content (SUP-01..04, LOST-01/02, FDBK-01; UC-S-19..22, UC-R-20, UC-D-21,
-- UC-A-21..25; contract docs/api/support-v1.yaml).
-- Owner rulings at the M14-T1 plan gate (2026-10-19), recorded in the contract header: priority
-- scale low/normal/high/urgent; up to 5 attachments (image or PDF) per ticket at creation only,
-- up to 3 photos per lost-item report; lost items are tickets of kind 'lost_item' in the seeded,
-- protected system category with default priority high — one open case per rider per ride, no
-- reporting cutoff; one waiting_on_user reminder after 48 h, closing is admin-only; feedback
-- categories are a fixed catalog; help CMS + ticket categories live behind the new content:*
-- permissions; all user notifications ride the existing 'account' category (NTF-01); SOS tickets
-- are the only admin-opened tickets.
--
-- State machines (also in the contract header):
--   ticket  : open -> in_progress -> waiting_on_user -> resolved -> closed
--             (waiting_on_user -> in_progress and resolved -> in_progress on a user reply;
--              closed is terminal and reachable only from resolved)
--   case    : reported -> driver_contacted -> found | not_found ; found -> returned ;
--             returned | not_found -> closed
--   A lost-item ticket's status mirrors its case: reported = open, driver_contacted/found =
--   in_progress, not_found/returned = resolved, closed = closed (DB-coupled for 'closed').

-- SUP-01/03, UC-A-24: admin-managed categories carrying the default priority. Categories are
-- deactivated, never deleted, once a ticket references them (FK) — existing tickets keep theirs.
-- The system row (lost items) is protected by trigger: never deactivated, never deleted.
CREATE TABLE ticket_categories (
    ticket_category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_code        VARCHAR(16),
    name_en            VARCHAR(80) NOT NULL,
    name_ar            VARCHAR(80) NOT NULL,
    default_priority   VARCHAR(6)  NOT NULL DEFAULT 'normal',
    sort_order         INTEGER     NOT NULL DEFAULT 0,
    active             BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_ticket_categories_system_code UNIQUE (system_code),
    CONSTRAINT ck_ticket_categories_names
        CHECK (length(btrim(name_en)) > 0 AND length(btrim(name_ar)) > 0),
    CONSTRAINT ck_ticket_categories_priority
        CHECK (default_priority IN ('low', 'normal', 'high', 'urgent'))
);

INSERT INTO ticket_categories (ticket_category_id, system_code, name_en, name_ar, default_priority,
                               sort_order)
VALUES ('00000000-0000-0000-0000-000000001401', 'lost_item', 'Lost item', 'مفقودات', 'high', 1000);

CREATE FUNCTION ticket_categories_protect_system() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.system_code IS NOT NULL THEN
            RAISE EXCEPTION 'system ticket categories are permanent';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.system_code IS NOT NULL
        AND (NEW.system_code IS DISTINCT FROM OLD.system_code OR NOT NEW.active) THEN
        RAISE EXCEPTION 'system ticket categories stay active';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ticket_categories_protect_system
    BEFORE UPDATE OR DELETE
    ON ticket_categories
    FOR EACH ROW
EXECUTE FUNCTION ticket_categories_protect_system();

-- SUP-01..03, LOST-01/02. One table for both kinds: a lost-item case IS a ticket (LOST-02) with
-- the extra case_status. user_id is the account the ticket belongs to (the thread's user side);
-- opened_by_user_id differs only for the SOS-linked tickets an admin opens on the caller's
-- behalf. priority_rank makes "priority then age" one index walk (SUP-03).
CREATE TABLE support_tickets (
    support_ticket_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID          NOT NULL REFERENCES users (user_id),
    kind               VARCHAR(9)    NOT NULL DEFAULT 'ticket',
    ticket_category_id UUID          NOT NULL REFERENCES ticket_categories (ticket_category_id),
    priority           VARCHAR(6)    NOT NULL,
    priority_rank      SMALLINT      GENERATED ALWAYS AS (
        CASE priority
            WHEN 'urgent' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            ELSE 3 END) STORED,
    status             VARCHAR(15)   NOT NULL DEFAULT 'open',
    case_status        VARCHAR(16),
    description        VARCHAR(4000) NOT NULL,
    ride_id            UUID REFERENCES rides (ride_id),
    assignee_user_id   UUID REFERENCES users (user_id),
    opened_by_user_id  UUID          NOT NULL REFERENCES users (user_id),
    sos_event_id       UUID REFERENCES sos_events (sos_event_id),
    -- Set on entering waiting_on_user, cleared on leaving it; the 48 h reminder is sent once.
    waiting_since      TIMESTAMPTZ,
    reminder_sent_at   TIMESTAMPTZ,
    resolved_at        TIMESTAMPTZ,
    closed_at          TIMESTAMPTZ,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT uq_support_tickets_sos_event UNIQUE (sos_event_id),
    CONSTRAINT ck_support_tickets_kind CHECK (kind IN ('ticket', 'lost_item')),
    CONSTRAINT ck_support_tickets_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    CONSTRAINT ck_support_tickets_status CHECK (
        status IN ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed')),
    CONSTRAINT ck_support_tickets_case_status CHECK (case_status IS NULL OR case_status IN (
        'reported', 'driver_contacted', 'found', 'not_found', 'returned', 'closed')),
    CONSTRAINT ck_support_tickets_description CHECK (length(btrim(description)) > 0),
    -- A case is exactly a lost-item ticket, and it always names its ride (LOST-01).
    CONSTRAINT ck_support_tickets_case_kind CHECK ((kind = 'lost_item') = (case_status IS NOT NULL)),
    CONSTRAINT ck_support_tickets_case_ride CHECK (kind <> 'lost_item' OR ride_id IS NOT NULL),
    -- The case and its ticket close together (the chat window follows the case, LOST-01).
    CONSTRAINT ck_support_tickets_case_closed CHECK (
        kind <> 'lost_item' OR ((case_status = 'closed') = (status = 'closed'))),
    CONSTRAINT ck_support_tickets_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
    CONSTRAINT ck_support_tickets_resolved CHECK (
        status NOT IN ('resolved', 'closed') OR resolved_at IS NOT NULL),
    CONSTRAINT ck_support_tickets_waiting CHECK (
        (status = 'waiting_on_user') = (waiting_since IS NOT NULL)),
    CONSTRAINT ck_support_tickets_reminder CHECK (reminder_sent_at IS NULL OR waiting_since IS NOT NULL),
    -- An SOS-linked ticket is about the SOS ride.
    CONSTRAINT ck_support_tickets_sos_ride CHECK (sos_event_id IS NULL OR ride_id IS NOT NULL)
);

CREATE INDEX idx_support_tickets_user ON support_tickets (user_id, updated_at DESC);
-- The admin queue (SUP-03): open work, most urgent first, oldest first within a priority.
CREATE INDEX idx_support_tickets_queue ON support_tickets (status, priority_rank, created_at);
CREATE INDEX idx_support_tickets_assignee
    ON support_tickets (assignee_user_id) WHERE assignee_user_id IS NOT NULL;
CREATE INDEX idx_support_tickets_ride ON support_tickets (ride_id) WHERE ride_id IS NOT NULL;
-- One open case per rider per ride (owner ruling); the same index answers "is this ride's chat
-- reopened for this rider" — the window is `reopened` while such a row exists (LOST-01).
CREATE UNIQUE INDEX uq_support_tickets_open_case
    ON support_tickets (ride_id, user_id) WHERE kind = 'lost_item' AND status <> 'closed';
-- The reminder job scans waiting tickets whose reminder is still due.
CREATE INDEX idx_support_tickets_waiting
    ON support_tickets (waiting_since) WHERE status = 'waiting_on_user' AND reminder_sent_at IS NULL;

-- Attachments are private stored files of their own kinds: ticket attachments may be PDFs (like
-- driver documents), lost-item photos are images only (like report photos).
ALTER TABLE stored_files
    DROP CONSTRAINT ck_stored_files_kind;
ALTER TABLE stored_files
    ALTER COLUMN kind TYPE VARCHAR(24);
ALTER TABLE stored_files
    ADD CONSTRAINT ck_stored_files_kind
        CHECK (kind IN ('document', 'vehicle_photo', 'report_photo', 'ticket_attachment',
                        'lost_item_photo'));
ALTER TABLE stored_files
    DROP CONSTRAINT ck_stored_files_pdf_documents_only;
ALTER TABLE stored_files
    ADD CONSTRAINT ck_stored_files_pdf_documents_only
        CHECK (kind IN ('document', 'ticket_attachment') OR content_type <> 'application/pdf');

-- Up to 5 per ticket (owner ruling), attached at creation only; a file is attached once. The
-- 3-photo cap of a lost-item report is the service's (it depends on the ticket's kind).
CREATE TABLE ticket_attachments (
    support_ticket_id UUID    NOT NULL REFERENCES support_tickets (support_ticket_id),
    stored_file_id    UUID    NOT NULL REFERENCES stored_files (stored_file_id),
    position          INTEGER NOT NULL,
    PRIMARY KEY (support_ticket_id, position),
    CONSTRAINT uq_ticket_attachments_file UNIQUE (stored_file_id),
    CONSTRAINT ck_ticket_attachments_position CHECK (position BETWEEN 1 AND 5)
);

-- SUP-02: the user <-> support thread. Messages persist forever; the ticket's status gates
-- writes (closed = read-only), never the rows.
CREATE TABLE ticket_messages (
    ticket_message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    support_ticket_id UUID          NOT NULL REFERENCES support_tickets (support_ticket_id),
    sender_user_id    UUID          NOT NULL REFERENCES users (user_id),
    sender_side       VARCHAR(7)    NOT NULL,
    body              VARCHAR(2000) NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_ticket_messages_side CHECK (sender_side IN ('user', 'support')),
    CONSTRAINT ck_ticket_messages_body CHECK (length(btrim(body)) > 0)
);

CREATE INDEX idx_ticket_messages_ticket
    ON ticket_messages (support_ticket_id, created_at, ticket_message_id);

-- SUP-02 "status/history in-app": every state, priority, assignment and case change with its
-- actor; the thread view merges these with the messages by time. System rows (the reminder)
-- have no actor user.
CREATE TABLE ticket_events (
    ticket_event_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    support_ticket_id UUID        NOT NULL REFERENCES support_tickets (support_ticket_id),
    type              VARCHAR(20) NOT NULL,
    actor_side        VARCHAR(7)  NOT NULL,
    actor_user_id     UUID REFERENCES users (user_id),
    from_value        VARCHAR(40),
    to_value          VARCHAR(40),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_ticket_events_type CHECK (type IN (
        'created', 'status_changed', 'priority_changed', 'assigned', 'case_status_changed',
        'reminder_sent')),
    CONSTRAINT ck_ticket_events_actor_side CHECK (actor_side IN ('user', 'support', 'system')),
    CONSTRAINT ck_ticket_events_actor CHECK ((actor_side = 'system') = (actor_user_id IS NULL)),
    CONSTRAINT ck_ticket_events_values CHECK (
        type NOT IN ('status_changed', 'priority_changed', 'case_status_changed')
            OR (from_value IS NOT NULL AND to_value IS NOT NULL))
);

CREATE INDEX idx_ticket_events_ticket ON ticket_events (support_ticket_id, created_at);

-- SUP-04, UC-A-23: the help center. A category is visible in the apps once it holds a published
-- article (no publish flag of its own); deleting one is refused by the FK while articles remain.
CREATE TABLE help_categories (
    help_category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_en          VARCHAR(80) NOT NULL,
    name_ar          VARCHAR(80) NOT NULL,
    sort_order       INTEGER     NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_help_categories_names
        CHECK (length(btrim(name_en)) > 0 AND length(btrim(name_ar)) > 0)
);

-- Drafts may be half-written (a working title in either language is enough); PUBLISHING with any
-- of the four texts missing is impossible at the DB level (UC-A-23 E1, NFR-I1, milestone AC).
-- Bodies are plain text with paragraphs, 20,000 characters max (owner ruling).
CREATE TABLE help_articles (
    help_article_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    help_category_id UUID         NOT NULL REFERENCES help_categories (help_category_id),
    title_en         VARCHAR(160),
    title_ar         VARCHAR(160),
    body_en          TEXT,
    body_ar          TEXT,
    sort_order       INTEGER      NOT NULL DEFAULT 0,
    status           VARCHAR(9)   NOT NULL DEFAULT 'draft',
    published_at     TIMESTAMPTZ,
    created_by       UUID         NOT NULL REFERENCES users (user_id),
    updated_by       UUID         NOT NULL REFERENCES users (user_id),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_help_articles_status CHECK (status IN ('draft', 'published')),
    CONSTRAINT ck_help_articles_working_title
        CHECK (length(btrim(coalesce(title_en, ''))) > 0 OR length(btrim(coalesce(title_ar, ''))) > 0),
    CONSTRAINT ck_help_articles_body_length
        CHECK (char_length(coalesce(body_en, '')) <= 20000
            AND char_length(coalesce(body_ar, '')) <= 20000),
    CONSTRAINT ck_help_articles_published_at CHECK ((status = 'published') = (published_at IS NOT NULL)),
    CONSTRAINT ck_help_articles_published_complete CHECK (
        status <> 'published'
            OR (length(btrim(coalesce(title_en, ''))) > 0
                AND length(btrim(coalesce(title_ar, ''))) > 0
                AND length(btrim(coalesce(body_en, ''))) > 0
                AND length(btrim(coalesce(body_ar, ''))) > 0))
);

CREATE INDEX idx_help_articles_category ON help_articles (help_category_id, sort_order);
-- The public reads and the search (substring on title + body in the user's language, V1 scale)
-- only ever touch published rows.
CREATE INDEX idx_help_articles_published
    ON help_articles (help_category_id, sort_order) WHERE status = 'published';

-- FDBK-01: not ride-bound; the fixed category catalog (owner ruling) is named in app i18n like
-- the badge catalog; submitted_as records which app sent it (an admin filter).
CREATE TABLE feedback (
    feedback_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID          NOT NULL REFERENCES users (user_id),
    submitted_as VARCHAR(6)    NOT NULL,
    category     VARCHAR(16)   NOT NULL,
    body         VARCHAR(2000) NOT NULL,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_feedback_submitted_as CHECK (submitted_as IN ('rider', 'driver')),
    CONSTRAINT ck_feedback_category CHECK (category IN (
        'app_experience', 'pricing', 'drivers', 'safety', 'feature_request', 'other')),
    CONSTRAINT ck_feedback_body CHECK (length(btrim(body)) > 0)
);

CREATE INDEX idx_feedback_created ON feedback (created_at DESC);
CREATE INDEX idx_feedback_category_created ON feedback (category, created_at);

-- Admin tags (UC-A-25): free text, trimmed, lower-cased, at most 30 characters, once per entry.
CREATE TABLE feedback_tags (
    feedback_id UUID        NOT NULL REFERENCES feedback (feedback_id),
    tag         VARCHAR(30) NOT NULL,
    tagged_by   UUID        NOT NULL REFERENCES users (user_id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (feedback_id, tag),
    CONSTRAINT ck_feedback_tags_shape CHECK (tag = btrim(tag) AND tag = lower(tag) AND length(tag) > 0)
);

CREATE INDEX idx_feedback_tags_tag ON feedback_tags (tag);

-- Help CMS and ticket-category management permissions (owner ruling: a content domain, not
-- support:handle). The catalog row is also synced from enums/Permission.java at boot; seeded
-- here so the grant can reference it. Super Admin only — the Support role is not granted them.
INSERT INTO permissions (code, domain)
VALUES ('content:view', 'content'),
       ('content:manage', 'content')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
         JOIN permissions p ON p.code IN ('content:view', 'content:manage')
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;
