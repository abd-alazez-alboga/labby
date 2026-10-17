-- M13 Growth (GRW-01..04, GAME-01..03; contract docs/api/growth-v1.yaml).
-- Owner money rulings 2026-10-18 are recorded in the contract header; the DB-level guarantees
-- the milestone AC names live here: redemption limits, referral uniqueness, exactly-once badges.

-- GRW-01/02: promo codes. Codes are globally unique; a fixed-amount promo must be region-bound
-- (its amount is in that region's currency), a percent promo may span regions.
CREATE TABLE promos (
    promo_id        UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    code            VARCHAR(20)    NOT NULL,
    region_id       UUID REFERENCES regions (region_id),
    service_type_id UUID REFERENCES service_types (service_type_id),
    type            VARCHAR(7)     NOT NULL,
    value           NUMERIC(12, 2) NOT NULL,
    -- Cap on the computed discount of a percent promo, in the ride currency.
    max_discount    NUMERIC(12, 2),
    starts_at       TIMESTAMPTZ    NOT NULL,
    ends_at         TIMESTAMPTZ    NOT NULL,
    per_user_limit  INTEGER        NOT NULL DEFAULT 1,
    -- NULL = uncapped; counted over promo_redemptions under the promo lock.
    total_cap       INTEGER,
    first_ride_only BOOLEAN        NOT NULL DEFAULT FALSE,
    active          BOOLEAN        NOT NULL DEFAULT TRUE,
    created_by      UUID           NOT NULL REFERENCES users (user_id),
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT uq_promos_code UNIQUE (code),
    CONSTRAINT ck_promos_code CHECK (code = upper(code) AND code ~ '^[A-Z0-9]{3,20}$'),
    CONSTRAINT ck_promos_type CHECK (type IN ('percent', 'fixed')),
    CONSTRAINT ck_promos_value CHECK (value > 0),
    CONSTRAINT ck_promos_percent CHECK (type <> 'percent' OR value <= 100),
    CONSTRAINT ck_promos_fixed_region CHECK (type <> 'fixed' OR region_id IS NOT NULL),
    CONSTRAINT ck_promos_max_discount CHECK (max_discount IS NULL OR max_discount > 0),
    CONSTRAINT ck_promos_window CHECK (ends_at > starts_at),
    CONSTRAINT ck_promos_per_user_limit CHECK (per_user_limit > 0),
    CONSTRAINT ck_promos_total_cap CHECK (total_cap IS NULL OR total_cap > 0)
);

-- One redemption per ride, ever (AC: redemption limits at DB level). Per-user and total caps
-- are counted over this table under the promo row lock; the amount is the discount actually
-- applied into the stored fare breakdown (never recomputed).
CREATE TABLE promo_redemptions (
    promo_redemption_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    promo_id            UUID           NOT NULL REFERENCES promos (promo_id),
    user_id             UUID           NOT NULL REFERENCES users (user_id),
    ride_id             UUID           NOT NULL REFERENCES rides (ride_id),
    amount              NUMERIC(12, 2) NOT NULL,
    currency            VARCHAR(3)     NOT NULL,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT uq_promo_redemptions_ride UNIQUE (ride_id),
    CONSTRAINT ck_promo_redemptions_amount CHECK (amount > 0)
);

CREATE INDEX idx_promo_redemptions_user ON promo_redemptions (promo_id, user_id);

-- GRW-03: each user shares ONE code (created lazily on first view).
CREATE TABLE referral_codes (
    user_id    UUID PRIMARY KEY REFERENCES users (user_id),
    code       VARCHAR(12) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_referral_codes_code UNIQUE (code),
    CONSTRAINT ck_referral_codes_code CHECK (code = upper(code) AND code ~ '^[A-Z0-9]{6,12}$')
);

-- A referee is captured once at registration and rewarded on their FIRST completed ride (both
-- sides). AC + owner ruling 2026-10-18: uniqueness at DB level — once per referee account AND
-- once per phone number EVER (rows are never deleted, so a deleted + reactivated account can
-- never retrigger a reward). Self-referral is refused in code and backstopped here.
CREATE TABLE referrals (
    referral_id      UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    referrer_user_id UUID        NOT NULL REFERENCES users (user_id),
    referee_user_id  UUID        NOT NULL REFERENCES users (user_id),
    referee_phone    VARCHAR(20) NOT NULL,
    status           VARCHAR(8)  NOT NULL DEFAULT 'pending',
    rewarded_ride_id UUID REFERENCES rides (ride_id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    rewarded_at      TIMESTAMPTZ,
    CONSTRAINT uq_referrals_referee UNIQUE (referee_user_id),
    CONSTRAINT uq_referrals_referee_phone UNIQUE (referee_phone),
    CONSTRAINT ck_referrals_status CHECK (status IN ('pending', 'rewarded', 'blocked')),
    CONSTRAINT ck_referrals_not_self CHECK (referrer_user_id <> referee_user_id),
    CONSTRAINT ck_referrals_rewarded CHECK (
        (status = 'rewarded') = (rewarded_ride_id IS NOT NULL AND rewarded_at IS NOT NULL))
);

CREATE INDEX idx_referrals_referrer ON referrals (referrer_user_id, created_at);

-- GRW-04 / GAME-03: redeemable spends down, lifetime only ever grows (levels never decrease on
-- redemption — the service enforces monotonicity, the signs are backstopped here).
CREATE TABLE points_accounts (
    user_id    UUID PRIMARY KEY REFERENCES users (user_id),
    redeemable BIGINT      NOT NULL DEFAULT 0,
    lifetime   BIGINT      NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_points_accounts_redeemable CHECK (redeemable >= 0),
    CONSTRAINT ck_points_accounts_lifetime CHECK (lifetime >= 0)
);

CREATE TABLE points_transactions (
    points_transaction_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    user_id               UUID        NOT NULL REFERENCES users (user_id),
    type                  VARCHAR(10) NOT NULL,
    points                BIGINT      NOT NULL,
    ride_id               UUID REFERENCES rides (ride_id),
    challenge_id          UUID,
    -- The wallet credit a redemption paid into (traceability, milestone AC).
    wallet_transaction_id UUID REFERENCES wallet_transactions (wallet_transaction_id),
    created_by            UUID REFERENCES users (user_id),
    reason                VARCHAR(500),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_points_transactions_type CHECK (
        type IN ('accrual', 'redemption', 'challenge', 'adjustment')),
    CONSTRAINT ck_points_transactions_points CHECK (points <> 0),
    CONSTRAINT ck_points_transactions_sign CHECK (
        (type IN ('accrual', 'challenge') AND points > 0)
            OR (type = 'redemption' AND points < 0)
            OR (type = 'adjustment')),
    CONSTRAINT ck_points_transactions_refs CHECK (
        (type <> 'accrual' OR ride_id IS NOT NULL)
            AND (type <> 'challenge' OR challenge_id IS NOT NULL)
            AND (type <> 'redemption' OR wallet_transaction_id IS NOT NULL)
            AND (type <> 'adjustment' OR created_by IS NOT NULL))
);

CREATE INDEX idx_points_transactions_user ON points_transactions (user_id, created_at);

-- GAME-01: the fixed catalog (owner 2026-10-18); display names live in app i18n by code.
CREATE TABLE badges (
    badge_code VARCHAR(32) PRIMARY KEY,
    sort_order INTEGER NOT NULL
);

INSERT INTO badges (badge_code, sort_order)
VALUES ('ride_10', 1),
       ('ride_50', 2),
       ('ride_100', 3),
       ('first_shared_ride', 4),
       ('first_referral', 5),
       ('five_star_week', 6);

-- Exactly-once awarding at DB level (milestone AC).
CREATE TABLE user_badges (
    user_id    UUID        NOT NULL REFERENCES users (user_id),
    badge_code VARCHAR(32) NOT NULL REFERENCES badges (badge_code),
    awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, badge_code)
);

-- GAME-02: admin-created challenges; an early end keeps completions already made (ended_at).
CREATE TABLE challenges (
    challenge_id  UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    region_id     UUID        NOT NULL REFERENCES regions (region_id),
    role          VARCHAR(6)  NOT NULL,
    title_en      VARCHAR(120) NOT NULL,
    title_ar      VARCHAR(120) NOT NULL,
    goal_type     VARCHAR(20) NOT NULL,
    goal_target   INTEGER     NOT NULL,
    reward_points BIGINT      NOT NULL,
    starts_at     TIMESTAMPTZ NOT NULL,
    ends_at       TIMESTAMPTZ NOT NULL,
    -- Set when an admin ends it early; progress stops, completed rewards stand.
    ended_at      TIMESTAMPTZ,
    created_by    UUID        NOT NULL REFERENCES users (user_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_challenges_role CHECK (role IN ('rider', 'driver')),
    CONSTRAINT ck_challenges_goal_type CHECK (
        goal_type IN ('completed_rides', 'shared_rides', 'five_star_ratings')),
    CONSTRAINT ck_challenges_goal_target CHECK (goal_target > 0),
    CONSTRAINT ck_challenges_reward CHECK (reward_points > 0),
    CONSTRAINT ck_challenges_window CHECK (ends_at > starts_at)
);

ALTER TABLE points_transactions
    ADD CONSTRAINT fk_points_transactions_challenge
        FOREIGN KEY (challenge_id) REFERENCES challenges (challenge_id);

-- One progress row per participant; the reward credit is exactly-once via the linked points
-- transaction (set once, under the row lock).
CREATE TABLE challenge_progress (
    challenge_id          UUID        NOT NULL REFERENCES challenges (challenge_id),
    user_id               UUID        NOT NULL REFERENCES users (user_id),
    progress              INTEGER     NOT NULL DEFAULT 0,
    completed_at          TIMESTAMPTZ,
    points_transaction_id UUID REFERENCES points_transactions (points_transaction_id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (challenge_id, user_id),
    CONSTRAINT uq_challenge_progress_credit UNIQUE (points_transaction_id),
    CONSTRAINT ck_challenge_progress_progress CHECK (progress >= 0),
    CONSTRAINT ck_challenge_progress_credit CHECK (
        points_transaction_id IS NULL OR completed_at IS NOT NULL)
);

CREATE INDEX idx_challenge_progress_user ON challenge_progress (user_id);

-- Growth knobs per region (owner ruling 2026-10-18: admin-editable, audited); NULL = defaults
-- {"referralReferrerAmount": …, "referralRefereeAmount": …, "pointsPerCurrencyUnit": 1,
--  "redemptionThresholdPoints": …, "redemptionRate": …} — shape validated by the service.
ALTER TABLE regions
    ADD COLUMN growth_settings JSONB,
    ADD CONSTRAINT ck_regions_growth_settings
        CHECK (growth_settings IS NULL OR jsonb_typeof(growth_settings) = 'object');
