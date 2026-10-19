-- M15-T3 incentives engine (incentives-v1.yaml; DRV-08, COM-01). One award per driver, region,
-- week and kind — the weekly job's exactly-once key — linked to the `bonus` ledger entry it posted.
-- Peak-hour windows live in regions.incentive_values (JSON), so no region column changes.

CREATE TABLE incentive_awards (
    incentive_award_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_user_id     UUID           NOT NULL REFERENCES users (user_id),
    region_id          UUID           NOT NULL REFERENCES regions (region_id),
    -- The region-local Monday of the evaluated week.
    week_start         DATE           NOT NULL,
    kind               VARCHAR(16)    NOT NULL,
    -- Week trips (weekly_trips / rating) or peak trips (peak_hours).
    trips              INTEGER        NOT NULL,
    -- The tier's trip count (weekly_trips only).
    threshold          INTEGER,
    -- The week's average rating (rating only).
    avg_rating         NUMERIC(3, 2),
    amount             NUMERIC(12, 2) NOT NULL,
    currency           VARCHAR(3)     NOT NULL,
    driver_ledger_id   UUID           NOT NULL REFERENCES driver_ledger (driver_ledger_id),
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT uq_incentive_awards_week UNIQUE (driver_user_id, region_id, week_start, kind),
    CONSTRAINT uq_incentive_awards_ledger UNIQUE (driver_ledger_id),
    CONSTRAINT ck_incentive_awards_kind CHECK (kind IN ('weekly_trips', 'peak_hours', 'rating')),
    CONSTRAINT ck_incentive_awards_amount CHECK (amount > 0),
    CONSTRAINT ck_incentive_awards_trips CHECK (trips >= 0),
    CONSTRAINT ck_incentive_awards_threshold CHECK ((kind = 'weekly_trips') = (threshold IS NOT NULL)),
    CONSTRAINT ck_incentive_awards_rating CHECK ((kind = 'rating') = (avg_rating IS NOT NULL)),
    CONSTRAINT ck_incentive_awards_week_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1)
);

-- The driver screen's recent awards (newest week first).
CREATE INDEX idx_incentive_awards_driver ON incentive_awards (driver_user_id, region_id, week_start DESC);
