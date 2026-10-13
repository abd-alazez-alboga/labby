-- M10: in-ride communication & safety (CHAT-01..03, CALL-01, SHARE-01/02, SAFE-01/02, ADM-03;
-- UC-S-13..16, UC-A-19/20). Contract: docs/api/comms-v1.yaml.
-- Owner rulings (2026-10-13): a ride cancelled after acceptance keeps its chat window open for
-- the same 24 h as a completion (dispute trail); one share link per user per ride, no revoke
-- (the link dies with the ride anyway); admin SOS alerting is web push + polling, no admin WS.

-- One thread per ride, created lazily at ACCEPTANCE (before that there is no counterpart).
-- Window state is DERIVED, never stored as an enum: open while closed_at is null or in the
-- future, or while reopened_until (the M14 lost-item hook) is in the future; read-only after.
-- closed_at is set to terminal_at + 24 h when the ride completes or is cancelled (CHAT-01).
-- The per-party read markers make unread counts one indexed comparison (CHAT-02).
CREATE TABLE chat_threads (
    chat_thread_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id        UUID        NOT NULL UNIQUE REFERENCES rides (ride_id),
    opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at      TIMESTAMPTZ,
    reopened_until TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_chat_threads_window CHECK (closed_at IS NULL OR closed_at > opened_at)
);

-- Localized one-tap quick replies (CHAT-02, NFR-U2). Code-addressed catalog: a message stores
-- the CODE and each client renders its own language from this table, so a language switch
-- re-renders history like the notification center does. Seeded below; copy drafted for the
-- owner's proofread (Western digits per the 2026-10-11 ruling).
CREATE TABLE chat_quick_replies (
    code       VARCHAR(40) PRIMARY KEY,
    audience   VARCHAR(6)   NOT NULL,
    text_en    VARCHAR(100) NOT NULL,
    text_ar    VARCHAR(100) NOT NULL,
    sort_order INTEGER      NOT NULL,
    active     BOOLEAN      NOT NULL DEFAULT true,
    CONSTRAINT ck_chat_quick_replies_audience CHECK (audience IN ('rider', 'driver', 'both'))
);

-- Messages persist forever (CHAT-03 — admin support visibility; the window only gates WRITES).
-- client_msg_id is the sender-generated dedup key: a WS resend after a reconnect hits the
-- unique constraint and the server answers with the already-stored message (T2 AC).
CREATE TABLE chat_messages (
    chat_message_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id        UUID        NOT NULL REFERENCES chat_threads (chat_thread_id),
    sender_user_id   UUID        NOT NULL REFERENCES users (user_id),
    sender_role      VARCHAR(6)  NOT NULL,
    kind             VARCHAR(11) NOT NULL,
    body             VARCHAR(1000),
    quick_reply_code VARCHAR(40) REFERENCES chat_quick_replies (code),
    client_msg_id    UUID        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_chat_messages_sender_role CHECK (sender_role IN ('rider', 'driver')),
    CONSTRAINT ck_chat_messages_kind CHECK (kind IN ('text', 'quick_reply')),
    -- A text message carries a body and no code; a quick reply carries a code and no body.
    CONSTRAINT ck_chat_messages_shape CHECK (
        (kind = 'text' AND body IS NOT NULL AND quick_reply_code IS NULL)
            OR (kind = 'quick_reply' AND quick_reply_code IS NOT NULL AND body IS NULL)),
    CONSTRAINT uq_chat_messages_dedup UNIQUE (thread_id, sender_user_id, client_msg_id)
);

-- History paging and unread counting walk a thread in time order.
CREATE INDEX idx_chat_messages_thread ON chat_messages (thread_id, created_at, chat_message_id);

-- Read markers point into chat_messages, so they are added after it exists.
ALTER TABLE chat_threads
    ADD COLUMN rider_last_read_message_id  UUID REFERENCES chat_messages (chat_message_id),
    ADD COLUMN driver_last_read_message_id UUID REFERENCES chat_messages (chat_message_id);

-- SHARE-01/02. Only the SHA-256 hex of the unguessable token is stored — the raw token is
-- returned once at creation and never persisted (T6 share-token security review). Liveness is
-- derived from the ride's state (active ride = live, terminal ride = 410 dead), so expiry at
-- ride end needs no clock. One link per user per ride: re-sharing returns nothing new to leak.
CREATE TABLE trip_share_links (
    trip_share_link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id            UUID        NOT NULL REFERENCES rides (ride_id),
    created_by_user_id UUID        NOT NULL REFERENCES users (user_id),
    token_hash         CHAR(64)    NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_trip_share_links_token UNIQUE (token_hash),
    CONSTRAINT uq_trip_share_links_ride_user UNIQUE (ride_id, created_by_user_id)
);

-- SAFE-01/02. An SOS event is PERMANENT: DELETE is always blocked and the facts of the event
-- (ride, who, where, when) are immutable; only the T4 handling fields (acknowledged_by,
-- acknowledged_at, note) may change, enforced by the trigger below. The ride's red flag on the
-- live map is derived from an open (unacknowledged) event's existence — no rides column.
-- triggered_at is the device moment (clamped server-side like ride traces); created_at is ours.
CREATE TABLE sos_events (
    sos_event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id           UUID                  NOT NULL REFERENCES rides (ride_id),
    triggered_by_user_id UUID               NOT NULL REFERENCES users (user_id),
    triggered_by_role VARCHAR(6)            NOT NULL,
    location          geometry(Point, 4326) NOT NULL,
    triggered_at      TIMESTAMPTZ           NOT NULL,
    acknowledged_by   UUID REFERENCES users (user_id),
    acknowledged_at   TIMESTAMPTZ,
    note              VARCHAR(2000),
    created_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),
    CONSTRAINT ck_sos_events_role CHECK (triggered_by_role IN ('rider', 'driver')),
    CONSTRAINT ck_sos_events_ack CHECK ((acknowledged_by IS NULL) = (acknowledged_at IS NULL))
);

CREATE INDEX idx_sos_events_ride ON sos_events (ride_id);
-- The admin alert list and the live-map pins read open events only.
CREATE INDEX idx_sos_events_open ON sos_events (created_at) WHERE acknowledged_at IS NULL;

CREATE FUNCTION sos_block_mutation() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'sos_events rows are permanent';
    END IF;
    IF NEW.sos_event_id IS DISTINCT FROM OLD.sos_event_id
        OR NEW.ride_id IS DISTINCT FROM OLD.ride_id
        OR NEW.triggered_by_user_id IS DISTINCT FROM OLD.triggered_by_user_id
        OR NEW.triggered_by_role IS DISTINCT FROM OLD.triggered_by_role
        OR NOT ST_Equals(NEW.location, OLD.location)
        OR NEW.triggered_at IS DISTINCT FROM OLD.triggered_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'sos_events core fields are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sos_events_block_mutation
    BEFORE UPDATE OR DELETE
    ON sos_events
    FOR EACH ROW
EXECUTE FUNCTION sos_block_mutation();

-- Quick-reply catalog v1 (EN/AR, owner-proofread; Western digits per the 2026-10-11 ruling).
INSERT INTO chat_quick_replies (code, audience, text_en, text_ar, sort_order)
VALUES ('driver_on_my_way', 'driver', 'On my way', 'أنا في الطريق', 10),
       ('driver_arrived', 'driver', 'I''ve arrived', 'وصلت', 20),
       ('driver_in_traffic', 'driver', 'Stuck in traffic', 'في ازدحام سير', 30),
       ('driver_cant_find', 'driver', 'I can''t find you', 'لا أستطيع إيجادك', 40),
       ('rider_coming', 'rider', 'I''m coming', 'أنا قادم', 10),
       ('rider_where_are_you', 'rider', 'Where are you now?', 'أين وصلت؟', 20),
       ('rider_wait_please', 'rider', 'One minute, please', 'دقيقة من فضلك', 30),
       ('both_okay', 'both', 'Okay', 'تمام', 90),
       ('both_thanks', 'both', 'Thank you', 'شكراً', 95);
