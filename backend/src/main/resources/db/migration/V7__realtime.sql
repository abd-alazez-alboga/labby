-- M6: realtime infrastructure (NTF-01..03, TRK-01, TRK-04, DRV-05 online/offline, ES-03, ES-04,
-- NFR-A3). Contract: docs/api/realtime-v1.yaml.
-- Delivery model: every notification is queued in notification_outbox (M5) and a dispatcher
-- renders it into the user's notification center (this table, EN + AR) and pushes it unless the
-- category is muted — so M5's already-queued rows flow through unchanged (M6-T2 "backfill hook").

-- The notification center (NTF-03): server-stored, survives reinstall/device change. Text is
-- rendered in BOTH languages at creation so a language switch re-renders instantly (NFR-I1).
CREATE TABLE notifications (
    notification_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID          NOT NULL REFERENCES users (user_id),
    -- Which client's center lists it; 'all' = every client of the account.
    audience               VARCHAR(8)    NOT NULL,
    category               VARCHAR(16)   NOT NULL,
    event                  VARCHAR(64)   NOT NULL,
    title_en               VARCHAR(200)  NOT NULL,
    body_en                VARCHAR(1000) NOT NULL,
    title_ar               VARCHAR(200)  NOT NULL,
    body_ar                VARCHAR(1000) NOT NULL,
    -- Deep link (UC-S-11): a screen id from the contract's catalog + its params.
    link_screen            VARCHAR(64),
    link_params            JSONB,
    read_at                TIMESTAMPTZ,
    -- Push outcome (NFR-A3: a failed/muted push never loses the center record).
    push_status            VARCHAR(12)   NOT NULL DEFAULT 'pending',
    pushed_at              TIMESTAMPTZ,
    notification_outbox_id UUID REFERENCES notification_outbox (notification_outbox_id),
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_notifications_audience CHECK (audience IN ('all', 'rider', 'driver', 'admin')),
    CONSTRAINT ck_notifications_category
        CHECK (category IN ('ride', 'chat', 'scheduled', 'promotions', 'account', 'safety')),
    CONSTRAINT ck_notifications_push_status
        CHECK (push_status IN ('pending', 'sent', 'muted', 'no_device', 'failed')),
    -- Exactly one center row per outbox row: the dispatcher is idempotent.
    CONSTRAINT uq_notifications_outbox UNIQUE (notification_outbox_id)
);

CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

-- Per-category opt-out (NTF-02). No row = enabled. Ride-critical and safety can never be muted.
CREATE TABLE notification_preferences (
    user_id    UUID        NOT NULL REFERENCES users (user_id),
    category   VARCHAR(16) NOT NULL,
    enabled    BOOLEAN     NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, category),
    CONSTRAINT ck_notification_preferences_category
        CHECK (category IN ('ride', 'chat', 'scheduled', 'promotions', 'account', 'safety')),
    CONSTRAINT ck_notification_preferences_locked
        CHECK (enabled OR category NOT IN ('ride', 'safety'))
);

-- FCM registration tokens (ES-03). A token belongs to one account at a time: a new login on the
-- same device re-assigns it.
CREATE TABLE device_tokens (
    device_token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users (user_id),
    token           TEXT        NOT NULL,
    platform        VARCHAR(8)  NOT NULL,
    app             VARCHAR(8)  NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_device_tokens_token UNIQUE (token),
    CONSTRAINT ck_device_tokens_platform CHECK (platform IN ('android', 'ios', 'web')),
    CONSTRAINT ck_device_tokens_app CHECK (app IN ('rider', 'driver', 'admin'))
);

CREATE INDEX idx_device_tokens_user ON device_tokens (user_id);

-- Online/offline (DRV-05, UC-D-04) lives on the driver record.
ALTER TABLE driver_profiles
    ADD COLUMN is_online         BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN online_changed_at TIMESTAMPTZ;

ALTER TABLE driver_profiles
    ADD CONSTRAINT ck_driver_profiles_online_approved
        CHECK (NOT is_online OR application_status = 'approved');

-- Latest position per driver (TRK-01). One row per driver, overwritten every sample; ride traces
-- (TRK-03, kept forever) arrive with M7. received_at drives stale-stream detection (TRK-04).
CREATE TABLE driver_locations (
    user_id     UUID PRIMARY KEY REFERENCES users (user_id),
    position    geometry(Point, 4326) NOT NULL,
    heading_deg REAL,
    speed_mps   REAL,
    accuracy_m  REAL,
    recorded_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_driver_locations_heading CHECK (heading_deg IS NULL OR (heading_deg >= 0 AND heading_deg < 360)),
    CONSTRAINT ck_driver_locations_speed CHECK (speed_mps IS NULL OR speed_mps >= 0),
    CONSTRAINT ck_driver_locations_accuracy CHECK (accuracy_m IS NULL OR accuracy_m >= 0)
);

CREATE INDEX idx_driver_locations_position ON driver_locations USING gist (position);
CREATE INDEX idx_driver_locations_received ON driver_locations (received_at);
