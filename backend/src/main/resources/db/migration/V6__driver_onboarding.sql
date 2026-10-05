-- M5: driver onboarding (DRV-01..04, USR-01 driver-role activation, NFR-S2; UC-D-01..03/18/19,
-- UC-A-10..12). Contract: docs/api/onboarding-v1.yaml.
-- Owner decisions (2026-10-05): "personal details" = the account's name + profile photo (no new
-- personal-data columns, only that item's review state); each document = ONE file, image or
-- PDF; vehicles carry 1..4 photos (images only); a plate already on another driver's ACTIVE
-- vehicle blocks approval (service rule, UC-A-10 E1 — deliberately NOT a unique constraint, the
-- duplicate must still be submittable and flagged).

-- Private uploads (NFR-S2). Bytes live behind the StorageProvider seam under storage_key; rows
-- are uploaded first and then referenced by id from documents / vehicle photos.
CREATE TABLE stored_files (
    stored_file_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id  UUID        NOT NULL REFERENCES users (user_id),
    kind           VARCHAR(16) NOT NULL,
    storage_key    TEXT        NOT NULL,
    content_type   VARCHAR(32) NOT NULL,
    size_bytes     BIGINT      NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_stored_files_storage_key UNIQUE (storage_key),
    CONSTRAINT ck_stored_files_kind CHECK (kind IN ('document', 'vehicle_photo')),
    CONSTRAINT ck_stored_files_content_type
        CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
    -- PDFs are accepted for documents only; vehicle photos are images.
    CONSTRAINT ck_stored_files_pdf_documents_only
        CHECK (kind = 'document' OR content_type <> 'application/pdf'),
    CONSTRAINT ck_stored_files_size CHECK (size_bytes > 0)
);

CREATE INDEX idx_stored_files_owner ON stored_files (owner_user_id);

-- One driver profile per account (USR-01): the application and, once approved, the driver's
-- record. Reapplication after rejection reuses the row (UC-D-03 A2); the stage history lives in
-- driver_application_events. version = optimistic lock against double review (M5-T2).
CREATE TABLE driver_profiles (
    driver_profile_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID          NOT NULL REFERENCES users (user_id),
    application_status     VARCHAR(16)   NOT NULL DEFAULT 'submitted',
    submitted_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    decided_at             TIMESTAMPTZ,
    decided_by             UUID REFERENCES users (user_id),
    rejection_reason       VARCHAR(1000),
    -- The "personal details" review item: the account's name + profile photo (users row).
    personal_review_status VARCHAR(20)   NOT NULL DEFAULT 'pending',
    personal_review_note   VARCHAR(1000),
    version                BIGINT        NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT uq_driver_profiles_user UNIQUE (user_id),
    CONSTRAINT ck_driver_profiles_status CHECK (application_status IN
        ('submitted', 'under_review', 'needs_changes', 'approved', 'rejected')),
    CONSTRAINT ck_driver_profiles_personal_review_status
        CHECK (personal_review_status IN ('pending', 'changes_requested', 'approved')),
    CONSTRAINT ck_driver_profiles_rejection_reason
        CHECK ((application_status = 'rejected') = (rejection_reason IS NOT NULL))
);

CREATE INDEX idx_driver_profiles_status ON driver_profiles (application_status, submitted_at);

-- Stage history with notes (UC-D-03). from_status is NULL for the first submission.
CREATE TABLE driver_application_events (
    driver_application_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_profile_id           UUID          NOT NULL REFERENCES driver_profiles (driver_profile_id),
    from_status                 VARCHAR(16),
    to_status                   VARCHAR(16)   NOT NULL,
    note                        VARCHAR(1000),
    actor_user_id               UUID          NOT NULL REFERENCES users (user_id),
    created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_driver_application_events_to CHECK (to_status IN
        ('submitted', 'under_review', 'needs_changes', 'approved', 'rejected'))
);

CREATE INDEX idx_driver_application_events_profile
    ON driver_application_events (driver_profile_id, created_at);

-- A driver's vehicles (DRV-03). The application's vehicle and every switch candidate are rows
-- here; a flagged vehicle is corrected in place (review_status back to pending). After a switch
-- the old row stays approved but inactive (history).
CREATE TABLE vehicles (
    vehicle_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_user_id UUID          NOT NULL REFERENCES users (user_id),
    make           VARCHAR(50)   NOT NULL,
    model          VARCHAR(50)   NOT NULL,
    year           SMALLINT      NOT NULL,
    color          VARCHAR(30)   NOT NULL,
    plate          VARCHAR(20)   NOT NULL,
    seats          SMALLINT      NOT NULL,
    review_status  VARCHAR(20)   NOT NULL DEFAULT 'pending',
    review_note    VARCHAR(1000),
    reviewed_by    UUID REFERENCES users (user_id),
    reviewed_at    TIMESTAMPTZ,
    is_active      BOOLEAN       NOT NULL DEFAULT false,
    version        BIGINT        NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_vehicles_review_status
        CHECK (review_status IN ('pending', 'changes_requested', 'approved', 'rejected')),
    CONSTRAINT ck_vehicles_active_is_approved CHECK (NOT is_active OR review_status = 'approved'),
    -- Upper year bound (next calendar year) is relative to "now" and lives in the service layer.
    CONSTRAINT ck_vehicles_year CHECK (year >= 1980),
    CONSTRAINT ck_vehicles_seats CHECK (seats BETWEEN 1 AND 8)
);

-- DRV-03: exactly one active vehicle per driver, enforced by the database.
CREATE UNIQUE INDEX uq_vehicles_one_active_per_driver ON vehicles (driver_user_id) WHERE is_active;
-- At most one vehicle in review per driver (the application's, or one switch at a time).
CREATE UNIQUE INDEX uq_vehicles_one_open_per_driver
    ON vehicles (driver_user_id) WHERE review_status IN ('pending', 'changes_requested');
-- Duplicate-plate lookup against active vehicles (UC-D-01 E3 / UC-A-10 E1).
CREATE INDEX idx_vehicles_active_plate ON vehicles (plate) WHERE is_active;

-- 1..4 photos per vehicle (owner decision); the first is the one riders see.
CREATE TABLE vehicle_photos (
    vehicle_id     UUID     NOT NULL REFERENCES vehicles (vehicle_id),
    position       INTEGER  NOT NULL,
    stored_file_id UUID     NOT NULL REFERENCES stored_files (stored_file_id),
    PRIMARY KEY (vehicle_id, position),
    CONSTRAINT ck_vehicle_photos_position CHECK (position BETWEEN 1 AND 4)
);

-- Service types the admin assigns at approval (DRV-03).
CREATE TABLE vehicle_service_types (
    vehicle_id      UUID NOT NULL REFERENCES vehicles (vehicle_id),
    service_type_id UUID NOT NULL REFERENCES service_types (service_type_id),
    PRIMARY KEY (vehicle_id, service_type_id)
);

CREATE INDEX idx_vehicle_service_types_service_type ON vehicle_service_types (service_type_id);

-- The four driver documents (DRV-01): photo/scan + number + expiry, each reviewed on its own.
-- Registration and insurance belong to a vehicle; ID and licence to the driver. A "slot" is
-- (driver, type, vehicle). A renewal (UC-D-19) is a new pending row beside the still-approved
-- one; on approval the old row becomes superseded.
CREATE TABLE documents (
    document_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_user_id      UUID          NOT NULL REFERENCES users (user_id),
    vehicle_id          UUID REFERENCES vehicles (vehicle_id),
    type                VARCHAR(24)   NOT NULL,
    number              VARCHAR(50)   NOT NULL,
    expires_on          DATE          NOT NULL,
    stored_file_id      UUID          NOT NULL REFERENCES stored_files (stored_file_id),
    review_status       VARCHAR(20)   NOT NULL DEFAULT 'pending',
    review_note         VARCHAR(1000),
    reviewed_by         UUID REFERENCES users (user_id),
    reviewed_at         TIMESTAMPTZ,
    reminder_30_sent_at TIMESTAMPTZ,
    reminder_7_sent_at  TIMESTAMPTZ,
    version             BIGINT        NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_documents_type CHECK (type IN
        ('government_id', 'drivers_license', 'vehicle_registration', 'insurance')),
    CONSTRAINT ck_documents_review_status CHECK (review_status IN
        ('pending', 'changes_requested', 'approved', 'rejected', 'superseded')),
    CONSTRAINT ck_documents_vehicle_binding
        CHECK ((type IN ('vehicle_registration', 'insurance')) = (vehicle_id IS NOT NULL))
);

CREATE UNIQUE INDEX uq_documents_one_approved_per_slot
    ON documents (driver_user_id, type, vehicle_id) NULLS NOT DISTINCT
    WHERE review_status = 'approved';
CREATE UNIQUE INDEX uq_documents_one_open_per_slot
    ON documents (driver_user_id, type, vehicle_id) NULLS NOT DISTINCT
    WHERE review_status IN ('pending', 'changes_requested');
-- Expiry job + expiry dashboard (DRV-04, UC-A-12).
CREATE INDEX idx_documents_approved_expiry ON documents (expires_on) WHERE review_status = 'approved';
CREATE INDEX idx_documents_driver ON documents (driver_user_id);

-- Notification seam outbox: stage changes are queued here until M6's notification center and
-- push delivery land (M6-T2 backfill hook). event = template key, params = template arguments.
CREATE TABLE notification_outbox (
    notification_outbox_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID        NOT NULL REFERENCES users (user_id),
    event                  VARCHAR(64) NOT NULL,
    params                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at           TIMESTAMPTZ
);

CREATE INDEX idx_notification_outbox_undelivered
    ON notification_outbox (created_at) WHERE delivered_at IS NULL;

-- Why a role is suspended (USR-04 "with the reason"). DRV-04's auto-suspension sets
-- document_expired; only that reason is lifted automatically by an approved renewal. Further
-- reasons (rating USR-05, manual USR-06) arrive with their milestones.
ALTER TABLE role_assignments
    ADD COLUMN suspension_reason VARCHAR(32);

ALTER TABLE role_assignments
    ADD CONSTRAINT ck_role_assignments_suspension_reason
        CHECK (suspension_reason IS NULL
            OR (state = 'suspended' AND suspension_reason IN ('document_expired')));
