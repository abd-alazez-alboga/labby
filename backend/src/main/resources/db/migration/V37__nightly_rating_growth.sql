-- V1 conformance H5 (owner ruling 2026-10-20): the driver incentives screen shows the weekly rating
-- average computed by the nightly job only, never a count; five-star badges and five_star_ratings
-- challenges are evaluated by the nightly job, not when a rating is stored.

-- The nightly weekly rating view of one driver in one region's week. Rewritten by the nightly
-- rating pass under the RATE-02 rule (no row yet, >= 3 new ratings, or the first exposure at 5).
-- rating_count is the rule's bookkeeping only; no endpoint ever returns it.
CREATE TABLE incentive_rating_snapshots (
    driver_user_id UUID          NOT NULL REFERENCES users (user_id),
    region_id      UUID          NOT NULL REFERENCES regions (region_id),
    -- The region-local Monday of the week.
    week_start     DATE          NOT NULL,
    -- 2 decimals rounded DOWN (the incentives display rule).
    avg_rating     NUMERIC(3, 2) NOT NULL,
    rating_count   INTEGER       NOT NULL,
    computed_at    TIMESTAMPTZ   NOT NULL,
    PRIMARY KEY (driver_user_id, region_id, week_start),
    CONSTRAINT ck_incentive_rating_snapshots_avg CHECK (avg_rating BETWEEN 1 AND 5),
    CONSTRAINT ck_incentive_rating_snapshots_count CHECK (rating_count > 0),
    CONSTRAINT ck_incentive_rating_snapshots_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1)
);

-- The 5-star ratings the nightly growth pass already evaluated (badge + challenge progress):
-- exactly once by the primary key.
CREATE TABLE rating_growth_evaluations (
    rating_id    UUID        PRIMARY KEY REFERENCES ratings (rating_id),
    evaluated_at TIMESTAMPTZ NOT NULL
);

-- Every 5-star rating stored so far was evaluated when it was stored (the pre-H5 behaviour).
INSERT INTO rating_growth_evaluations (rating_id, evaluated_at)
SELECT rating_id, now() FROM ratings WHERE score = 5;
