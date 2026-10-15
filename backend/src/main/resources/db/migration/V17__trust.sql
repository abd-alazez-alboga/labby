-- M11: trust & quality (RATE-01..03, REP-01..03, USR-04..06, DRV-06/07; UC-S-17/18, UC-D-20,
-- UC-A-14/16/17). Contract: docs/api/trust-v1.yaml.
-- Owner rulings (2026-10-15): averages are LIFETIME per role; the RATE-03 warning flag sits
-- 0.5 above the region's USR-05 suspension level (same minimum count); the rated user and the
-- counterpart see only a DAILY snapshot, and the own average only from 5 ratings on (RATE-02
-- timing side channel); suspension and flags evaluate live. DRV-07 warnings evaluate the 30-day
-- window with a minimum sample of 20 (offers / accepted rides). REP-03 values are platform
-- config (REPORT_FLAG_COUNT / REPORT_FLAG_DAYS). One report per ride per reporter, at most 3
-- photos, no time window. USR-06 "deactivate" = whole-account suspension (users.state).
-- Driver metrics are computed on read from ride_offers / rides — only warnings are stored.

-- RATE-01: one rating per ride per rater side, immutable (trigger below). rated_* are
-- denormalized from the ride at insert so aggregates are one indexed scan. The 7-day window and
-- "ride completed" are service rules (they need the ride); everything else is enforced here.
CREATE TABLE ratings (
    rating_id     UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    ride_id       UUID        NOT NULL REFERENCES rides (ride_id),
    rater_user_id UUID        NOT NULL REFERENCES users (user_id),
    rater_role    VARCHAR(6)  NOT NULL,
    rated_user_id UUID        NOT NULL REFERENCES users (user_id),
    rated_role    VARCHAR(6)  NOT NULL,
    score         SMALLINT    NOT NULL,
    comment       VARCHAR(1000),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_ratings_ride_rater_role UNIQUE (ride_id, rater_role),
    CONSTRAINT ck_ratings_rater_role CHECK (rater_role IN ('rider', 'driver')),
    -- A rider rates the driver role and vice versa (USR-02: ratings are per role).
    CONSTRAINT ck_ratings_rated_role CHECK (
        (rater_role = 'rider' AND rated_role = 'driver')
            OR (rater_role = 'driver' AND rated_role = 'rider')),
    CONSTRAINT ck_ratings_distinct_parties CHECK (rater_user_id <> rated_user_id),
    CONSTRAINT ck_ratings_score CHECK (score BETWEEN 1 AND 5)
);

-- Live per-role aggregates (USR-05 / RATE-03 evaluation, admin views).
CREATE INDEX idx_ratings_rated ON ratings (rated_user_id, rated_role, created_at);

CREATE FUNCTION ratings_block_mutation() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    RAISE EXCEPTION 'ratings are immutable';
END;
$$;

CREATE TRIGGER trg_ratings_immutable
    BEFORE UPDATE OR DELETE
    ON ratings
    FOR EACH ROW
EXECUTE FUNCTION ratings_block_mutation();

-- RATE-02 exposure: the ONLY source of averages shown to the rated user and to counterparts in
-- matching contexts. Rewritten once a day by a job (T2), so a single new rating never visibly
-- moves the number the moment a ride ends. One row per user x role that has any rating.
CREATE TABLE rating_snapshots (
    user_id      UUID         NOT NULL REFERENCES users (user_id),
    role         VARCHAR(6)   NOT NULL,
    avg_score    NUMERIC(3, 2) NOT NULL,
    rating_count INTEGER      NOT NULL,
    computed_at  TIMESTAMPTZ  NOT NULL,
    PRIMARY KEY (user_id, role),
    CONSTRAINT ck_rating_snapshots_role CHECK (role IN ('rider', 'driver')),
    CONSTRAINT ck_rating_snapshots_avg CHECK (avg_score BETWEEN 1 AND 5),
    CONSTRAINT ck_rating_snapshots_count CHECK (rating_count > 0)
);

-- REP-01 photos are private stored files of their own kind (images only).
ALTER TABLE stored_files
    DROP CONSTRAINT ck_stored_files_kind;
ALTER TABLE stored_files
    ADD CONSTRAINT ck_stored_files_kind
        CHECK (kind IN ('document', 'vehicle_photo', 'report_photo'));

-- REP-01/02. Categories are per direction (UC-S-18 "mirrored categories for reporting riders").
-- A report is never deleted, its facts never change, and it is resolved exactly once
-- (open -> substantiated | unsubstantiated, with resolver, moment and notes) — trigger below.
-- The resolution notes are internal: the reporter only ever learns the outcome.
CREATE TABLE reports (
    report_id        UUID PRIMARY KEY      DEFAULT gen_random_uuid(),
    ride_id          UUID         NOT NULL REFERENCES rides (ride_id),
    reporter_user_id UUID         NOT NULL REFERENCES users (user_id),
    reporter_role    VARCHAR(6)   NOT NULL,
    reported_user_id UUID         NOT NULL REFERENCES users (user_id),
    reported_role    VARCHAR(6)   NOT NULL,
    category         VARCHAR(24)  NOT NULL,
    description      VARCHAR(2000),
    status           VARCHAR(16)  NOT NULL DEFAULT 'open',
    resolution_note  VARCHAR(2000),
    resolved_by      UUID REFERENCES users (user_id),
    resolved_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_reports_ride_reporter UNIQUE (ride_id, reporter_user_id),
    CONSTRAINT ck_reports_reporter_role CHECK (reporter_role IN ('rider', 'driver')),
    CONSTRAINT ck_reports_reported_role CHECK (
        (reporter_role = 'rider' AND reported_role = 'driver')
            OR (reporter_role = 'driver' AND reported_role = 'rider')),
    CONSTRAINT ck_reports_distinct_parties CHECK (reporter_user_id <> reported_user_id),
    CONSTRAINT ck_reports_category CHECK (
        (reporter_role = 'rider' AND category IN ('unsafe_driving', 'inappropriate_behavior',
                                                  'vehicle_condition', 'other'))
            OR (reporter_role = 'driver' AND category IN ('unsafe_behavior',
                                                          'inappropriate_behavior',
                                                          'vehicle_damage', 'other'))),
    CONSTRAINT ck_reports_status CHECK (status IN ('open', 'substantiated', 'unsubstantiated')),
    CONSTRAINT ck_reports_resolution CHECK (
        (status = 'open' AND resolution_note IS NULL AND resolved_by IS NULL
            AND resolved_at IS NULL)
            OR (status <> 'open' AND resolution_note IS NOT NULL AND resolved_by IS NOT NULL
            AND resolved_at IS NOT NULL))
);

-- The admin queue: open first, oldest first.
CREATE INDEX idx_reports_queue ON reports (status, created_at);
-- REP-03 sliding window: substantiated reports against one user x role by resolution moment.
CREATE INDEX idx_reports_reported ON reports (reported_user_id, reported_role, status, resolved_at);
CREATE INDEX idx_reports_reporter ON reports (reporter_user_id, created_at DESC);

CREATE FUNCTION reports_guard_mutation() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'reports are permanent';
    END IF;
    IF OLD.status <> 'open' THEN
        RAISE EXCEPTION 'a resolved report is final';
    END IF;
    IF NEW.report_id IS DISTINCT FROM OLD.report_id
        OR NEW.ride_id IS DISTINCT FROM OLD.ride_id
        OR NEW.reporter_user_id IS DISTINCT FROM OLD.reporter_user_id
        OR NEW.reporter_role IS DISTINCT FROM OLD.reporter_role
        OR NEW.reported_user_id IS DISTINCT FROM OLD.reported_user_id
        OR NEW.reported_role IS DISTINCT FROM OLD.reported_role
        OR NEW.category IS DISTINCT FROM OLD.category
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'report facts are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reports_guard_mutation
    BEFORE UPDATE OR DELETE
    ON reports
    FOR EACH ROW
EXECUTE FUNCTION reports_guard_mutation();

-- At most 3 photos per report (positions 0..2); a file belongs to one report only.
CREATE TABLE report_photos (
    report_id      UUID     NOT NULL REFERENCES reports (report_id),
    position       SMALLINT NOT NULL,
    stored_file_id UUID     NOT NULL REFERENCES stored_files (stored_file_id),
    PRIMARY KEY (report_id, position),
    CONSTRAINT uq_report_photos_file UNIQUE (stored_file_id),
    CONSTRAINT ck_report_photos_position CHECK (position BETWEEN 0 AND 2)
);

-- DRV-07 warnings as raised/cleared intervals. At most one ACTIVE warning per driver x metric;
-- value/threshold/sample are the evaluation that raised it (shown with "the triggering rule",
-- UC-D-20). Percentages are 0..100.
CREATE TABLE driver_metric_warnings (
    driver_metric_warning_id UUID PRIMARY KEY      DEFAULT gen_random_uuid(),
    driver_user_id           UUID         NOT NULL REFERENCES users (user_id),
    metric                   VARCHAR(12)  NOT NULL,
    value_percent            NUMERIC(5, 2) NOT NULL,
    threshold_percent        NUMERIC(5, 2) NOT NULL,
    window_days              SMALLINT     NOT NULL,
    sample_size              INTEGER      NOT NULL,
    raised_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    cleared_at               TIMESTAMPTZ,
    CONSTRAINT ck_driver_metric_warnings_metric CHECK (metric IN ('acceptance', 'cancellation')),
    CONSTRAINT ck_driver_metric_warnings_percent CHECK (
        value_percent BETWEEN 0 AND 100 AND threshold_percent BETWEEN 0 AND 100),
    CONSTRAINT ck_driver_metric_warnings_window CHECK (window_days > 0 AND sample_size > 0),
    CONSTRAINT ck_driver_metric_warnings_cleared CHECK (cleared_at IS NULL OR cleared_at >= raised_at)
);

CREATE UNIQUE INDEX uq_driver_metric_warnings_active
    ON driver_metric_warnings (driver_user_id, metric) WHERE cleared_at IS NULL;

-- ADM-04 flagged-accounts queue (UC-A-16): low rating (RATE-03), metric warning (DRV-07, driver
-- only), report threshold (REP-03). details = the triggering evaluation (rule + numbers +
-- evidence ids), shape per kind in the contract. One OPEN flag per user x role x kind; acting
-- or dismissing always carries a note.
CREATE TABLE account_flags (
    account_flag_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users (user_id),
    role            VARCHAR(6)  NOT NULL,
    kind            VARCHAR(16) NOT NULL,
    details         JSONB       NOT NULL,
    status          VARCHAR(10) NOT NULL DEFAULT 'open',
    raised_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_by     UUID REFERENCES users (user_id),
    resolved_at     TIMESTAMPTZ,
    resolution_note VARCHAR(2000),
    CONSTRAINT ck_account_flags_role CHECK (role IN ('rider', 'driver')),
    CONSTRAINT ck_account_flags_kind CHECK (kind IN ('low_rating', 'metric_warning',
                                                     'report_threshold')),
    CONSTRAINT ck_account_flags_metric_driver CHECK (kind <> 'metric_warning' OR role = 'driver'),
    CONSTRAINT ck_account_flags_status CHECK (status IN ('open', 'actioned', 'dismissed')),
    CONSTRAINT ck_account_flags_resolution CHECK (
        (status = 'open' AND resolved_by IS NULL AND resolved_at IS NULL
            AND resolution_note IS NULL)
            OR (status <> 'open' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
            AND resolution_note IS NOT NULL))
);

CREATE UNIQUE INDEX uq_account_flags_open ON account_flags (user_id, role, kind)
    WHERE status = 'open';
CREATE INDEX idx_account_flags_queue ON account_flags (status, raised_at);
CREATE INDEX idx_account_flags_user ON account_flags (user_id, raised_at DESC);

-- USR-04/05/06 role-level suspension: rating auto-suspension (low_rating) and admin action
-- (manual, free-text note mandatory) join DRV-04's document_expired. Automatic suspensions only
-- ever hit an ACTIVE role; an admin's manual suspension replaces an automatic reason, so a
-- renewal approval never lifts a rating or manual suspension.
ALTER TABLE role_assignments
    DROP CONSTRAINT ck_role_assignments_suspension_reason;
ALTER TABLE role_assignments
    ADD COLUMN suspension_note VARCHAR(500),
    ADD COLUMN suspended_at    TIMESTAMPTZ;
ALTER TABLE role_assignments
    ADD CONSTRAINT ck_role_assignments_suspension_reason
        CHECK (suspension_reason IS NULL
            OR (state = 'suspended'
                AND suspension_reason IN ('document_expired', 'low_rating', 'manual'))),
    ADD CONSTRAINT ck_role_assignments_suspension_note
        CHECK ((suspension_reason IS NOT DISTINCT FROM 'manual') = (suspension_note IS NOT NULL));

-- USR-06 "deactivate" = whole-account suspension (owner ruling): users.state = suspended with a
-- mandatory note. Only an admin does this, so the only reason is manual.
ALTER TABLE users
    ADD COLUMN suspension_reason VARCHAR(32),
    ADD COLUMN suspension_note   VARCHAR(500),
    ADD COLUMN suspended_at      TIMESTAMPTZ;
ALTER TABLE users
    ADD CONSTRAINT ck_users_suspension_reason
        CHECK (suspension_reason IS NULL
            OR (state = 'suspended' AND suspension_reason = 'manual')),
    ADD CONSTRAINT ck_users_suspension_note
        CHECK ((suspension_reason IS NULL) = (suspension_note IS NULL));

-- DRV-07 per-region config: {minAcceptancePercent, maxCancellationPercent, windowDays,
-- minSample}; NULL = the SRS defaults (50 / 15 / 30 / 20), like driver_balance_floor.
-- The RATE-03 warning level rides inside suspension_thresholds (warnAvgRating, optional:
-- absent = minAvgRating + 0.5) — no column change.
ALTER TABLE regions
    ADD COLUMN metric_warnings JSONB;

-- DRV-06 windows read a driver's accepted rides by acceptance moment.
CREATE INDEX idx_rides_driver_accepted ON rides (driver_user_id, accepted_at)
    WHERE accepted_at IS NOT NULL;

-- Report handling permissions (RBAC-04: Support handles reports). The catalog row is also
-- synced from enums/Permission.java at boot; seeded here so the Support grant can reference it.
INSERT INTO permissions (code, domain)
VALUES ('reports:view', 'reports'),
       ('reports:handle', 'reports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
         JOIN permissions p ON p.code IN ('reports:view', 'reports:handle')
WHERE r.name IN ('Super Admin', 'Support')
ON CONFLICT DO NOTHING;
