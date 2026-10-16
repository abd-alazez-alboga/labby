-- M12: scheduled & shared rides (RIDE-S1..4, RIDE-P1..5, DRV-05 weekly windows; UC-R-10..15,
-- UC-D-05, UC-D-11..13). Contract: docs/api/scheduled-shared-v1.yaml.
-- Owner rulings (2026-10-16): a claimed scheduled ride converts to a live `accepted` ride at
-- T - fallback lead (default 15 min, the same moment an unclaimed one falls into live dispatch);
-- scheduling less than the minimum lead ahead (default 30 min) is rejected; a scheduled ride
-- cancels free until it converts to live, then RIDE-07 applies; a timed shared ride
-- auto-dispatches at its departure time with whoever joined, a "when full" ride auto-cancels
-- after 24 h unfilled. Plan readings (approved): the final fare is split over the seats of the
-- members who BOARDED (remainder of the 2-dp rounding to the creator, else the earliest boarded
-- member); a no-show member pays the region's no-show cancellation fee instead of a share;
-- dispatch needs a vehicle with seats >= the occupied seats.
-- Both kinds stay ordinary `rides` rows; their extra data lives in the extension tables below.

-- New pre-live states: `scheduled` (waiting for its time, claimed or not) and `gathering`
-- (a shared ride collecting members). Neither holds a driver on the ride row — a claim lives in
-- scheduled_rides until conversion — and neither counts as the rider's active ride.
ALTER TABLE rides
    DROP CONSTRAINT ck_rides_state;
ALTER TABLE rides
    ADD CONSTRAINT ck_rides_state CHECK (state IN ('scheduled', 'gathering', 'requested',
        'offering', 'accepted', 'driver_arrived', 'in_progress', 'completed',
        'cancelled_by_rider', 'cancelled_by_driver', 'no_driver_found'));
ALTER TABLE rides
    ADD CONSTRAINT ck_rides_kind_state CHECK (
        (state <> 'scheduled' OR kind = 'scheduled')
        AND (state <> 'gathering' OR kind = 'shared'));
ALTER TABLE rides
    DROP CONSTRAINT ck_rides_driver_bound;
ALTER TABLE rides
    ADD CONSTRAINT ck_rides_driver_bound CHECK (
        (state IN ('scheduled', 'gathering', 'requested', 'offering', 'no_driver_found')
            AND driver_user_id IS NULL AND vehicle_id IS NULL)
        OR (state IN ('accepted', 'driver_arrived', 'in_progress', 'completed',
                      'cancelled_by_driver')
            AND driver_user_id IS NOT NULL AND vehicle_id IS NOT NULL)
        OR (state = 'cancelled_by_rider'
            AND (driver_user_id IS NULL) = (vehicle_id IS NULL)));

-- `shared_expired` = the system cancelled a "when full" shared ride left unfilled for 24 h (no
-- fee, never chosen by a party — like `account_suspended`).
ALTER TABLE rides
    DROP CONSTRAINT ck_rides_cancellation_reason;
ALTER TABLE rides
    ADD CONSTRAINT ck_rides_cancellation_reason CHECK (cancellation_reason IS NULL
        OR cancellation_reason IN ('changed_mind', 'driver_too_far', 'wrong_pickup',
            'rider_no_show', 'vehicle_issue', 'unsafe_pickup', 'other', 'account_suspended',
            'shared_expired'));

-- RIDE-P4: a completed shared ride is paid per member (shared_ride_members); the ride row only
-- says `split`. Its payment_confirmed_at is set once every member's share is resolved.
ALTER TABLE rides
    DROP CONSTRAINT ck_rides_payment_status;
ALTER TABLE rides
    ADD CONSTRAINT ck_rides_payment_status CHECK (
        (payment_status IS NULL AND state <> 'completed')
        OR (state = 'completed' AND kind <> 'shared'
            AND payment_status IN ('pending', 'paid_cash', 'paid_wallet', 'paid_mixed',
                                   'unpaid'))
        OR (state = 'completed' AND kind = 'shared' AND payment_status = 'split'));
ALTER TABLE rides
    DROP CONSTRAINT ck_rides_payment_confirmed;
ALTER TABLE rides
    ADD CONSTRAINT ck_rides_payment_confirmed CHECK (
        payment_status = 'split'
        OR (payment_confirmed_at IS NOT NULL)
            = (payment_status IN ('paid_cash', 'paid_wallet', 'paid_mixed', 'unpaid')));

-- RIDE-P2 browse: open shared rides by region and destination.
CREATE INDEX idx_rides_gathering_region ON rides (region_id) WHERE state = 'gathering';
CREATE INDEX idx_rides_gathering_destination ON rides USING gist (destination)
    WHERE state = 'gathering';

-- DRV-05 / UC-D-05: recurring weekly windows gating the claim board. One row per weekday x
-- range, wall-clock times read in the time zone of the ride's region (a driver has no region
-- of their own). Same window semantics as surcharge windows: start inclusive, end exclusive;
-- end < start spans midnight and belongs to the day it starts on; start = end covers that whole
-- day. The driver replaces the whole set at once (contract), so there is no overlap rule.
CREATE TABLE availability_windows (
    availability_window_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_user_id         UUID        NOT NULL REFERENCES users (user_id),
    -- ISO weekday: 1 = Monday .. 7 = Sunday.
    day_of_week            SMALLINT    NOT NULL,
    starts_at              TIME        NOT NULL,
    ends_at                TIME        NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_availability_windows_day CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT uq_availability_windows UNIQUE (driver_user_id, day_of_week, starts_at, ends_at)
);

CREATE INDEX idx_availability_windows_driver ON availability_windows (driver_user_id);

-- RIDE-S1..4: one row per scheduled ride (rides.kind = 'scheduled'). The claim (RIDE-S2) is
-- held here until conversion; claiming and releasing lock the RIDE row first, like every other
-- ride writer. Reminder marks are per party; the driver's marks belong to the current claim and
-- are cleared when it is released. fallback_at = handed to live dispatch unclaimed (RIDE-S4);
-- converted_at = the claimed ride became `accepted` (RIDE-S3) — at most one of them happens.
CREATE TABLE scheduled_rides (
    ride_id                   UUID PRIMARY KEY REFERENCES rides (ride_id),
    scheduled_at              TIMESTAMPTZ NOT NULL,
    claimed_driver_user_id    UUID REFERENCES users (user_id),
    claimed_vehicle_id        UUID REFERENCES vehicles (vehicle_id),
    claimed_at                TIMESTAMPTZ,
    rider_reminder_first_at   TIMESTAMPTZ,
    rider_reminder_second_at  TIMESTAMPTZ,
    driver_reminder_first_at  TIMESTAMPTZ,
    driver_reminder_second_at TIMESTAMPTZ,
    fallback_at               TIMESTAMPTZ,
    converted_at              TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_scheduled_rides_claim CHECK (
        (claimed_driver_user_id IS NULL) = (claimed_vehicle_id IS NULL)
        AND (claimed_driver_user_id IS NULL) = (claimed_at IS NULL)),
    CONSTRAINT ck_scheduled_rides_driver_reminders CHECK (
        claimed_driver_user_id IS NOT NULL
        OR (driver_reminder_first_at IS NULL AND driver_reminder_second_at IS NULL)),
    CONSTRAINT ck_scheduled_rides_outcome CHECK (fallback_at IS NULL OR converted_at IS NULL),
    -- Only a claimed ride converts; a ride handed to live dispatch holds no claim.
    CONSTRAINT ck_scheduled_rides_converted
        CHECK (converted_at IS NULL OR claimed_driver_user_id IS NOT NULL),
    CONSTRAINT ck_scheduled_rides_fallback
        CHECK (fallback_at IS NULL OR claimed_driver_user_id IS NULL)
);

-- The clock job's scan (reminders, conversion, fallback) and the claim board both read pending
-- rows by time.
CREATE INDEX idx_scheduled_rides_pending ON scheduled_rides (scheduled_at)
    WHERE fallback_at IS NULL AND converted_at IS NULL;
CREATE INDEX idx_scheduled_rides_claimed_driver ON scheduled_rides (claimed_driver_user_id,
    scheduled_at) WHERE claimed_driver_user_id IS NOT NULL;

-- UC-D-12 E1: a released claim feeds the driver's cancellation metric (DRV-06) — the trail is
-- kept, the claim itself is cleared on scheduled_rides. Append-only like the other trails.
-- Reasons are the RIDE-07 driver reasons that apply before pickup; `account_suspended` = the
-- system released the claim of a driver an admin suspended (never chosen, not a metric event).
CREATE TABLE scheduled_claim_releases (
    scheduled_claim_release_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id                    UUID         NOT NULL REFERENCES scheduled_rides (ride_id),
    driver_user_id             UUID         NOT NULL REFERENCES users (user_id),
    claimed_at                 TIMESTAMPTZ  NOT NULL,
    released_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    reason                     VARCHAR(24)  NOT NULL,
    note                       VARCHAR(500),
    CONSTRAINT ck_scheduled_claim_releases_reason
        CHECK (reason IN ('vehicle_issue', 'unsafe_pickup', 'other', 'account_suspended')),
    CONSTRAINT ck_scheduled_claim_releases_note CHECK (reason <> 'other' OR note IS NOT NULL),
    CONSTRAINT ck_scheduled_claim_releases_order CHECK (released_at >= claimed_at)
);

CREATE TRIGGER trg_scheduled_claim_releases_append_only
    BEFORE UPDATE OR DELETE
    ON scheduled_claim_releases
    FOR EACH ROW
EXECUTE FUNCTION money_block_mutation();

CREATE INDEX idx_scheduled_claim_releases_driver
    ON scheduled_claim_releases (driver_user_id, released_at);

-- RIDE-P1..5: one row per shared ride (rides.kind = 'shared'; rides.rider_user_id = the
-- creator). seats_taken caches the party sizes of the `joined` members; every join/leave locks
-- the RIDE row first and the check below is the last-seat backstop (two joiners racing for the
-- last seat: the second write fails). total_seats <= 8 = the largest vehicle (ck_vehicles_seats).
CREATE TABLE shared_rides (
    ride_id          UUID PRIMARY KEY REFERENCES rides (ride_id),
    total_seats      SMALLINT    NOT NULL,
    seats_taken      SMALLINT    NOT NULL,
    departure_mode   VARCHAR(10) NOT NULL,
    departure_at     TIMESTAMPTZ,
    -- "when full" rides only: created_at + 24 h (owner ruling); the job cancels after it.
    expires_at       TIMESTAMPTZ,
    dispatch_trigger VARCHAR(14),
    dispatched_at    TIMESTAMPTZ,
    -- Set at completion (RIDE-P4): the boarded seats the fare was divided by, and one seat's
    -- price before rounding remainders.
    split_seats      SMALLINT,
    per_seat_amount  NUMERIC(10, 2),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_shared_rides_total_seats CHECK (total_seats BETWEEN 2 AND 8),
    CONSTRAINT ck_shared_rides_seats_taken CHECK (seats_taken BETWEEN 0 AND total_seats),
    CONSTRAINT ck_shared_rides_departure CHECK (
        (departure_mode = 'at_time' AND departure_at IS NOT NULL AND expires_at IS NULL)
        OR (departure_mode = 'when_full' AND departure_at IS NULL AND expires_at IS NOT NULL)),
    CONSTRAINT ck_shared_rides_dispatch_trigger CHECK (dispatch_trigger IS NULL
        OR dispatch_trigger IN ('creator', 'full', 'departure_time')),
    CONSTRAINT ck_shared_rides_dispatched
        CHECK ((dispatch_trigger IS NULL) = (dispatched_at IS NULL)),
    CONSTRAINT ck_shared_rides_split CHECK (
        (split_seats IS NULL) = (per_seat_amount IS NULL)
        AND (split_seats IS NULL OR (split_seats >= 1 AND split_seats <= total_seats
                                     AND per_seat_amount >= 0)))
);

-- The clock job: timed rides due for departure, "when full" rides due to expire.
CREATE INDEX idx_shared_rides_departure ON shared_rides (departure_at)
    WHERE dispatched_at IS NULL AND departure_at IS NOT NULL;
CREATE INDEX idx_shared_rides_expiry ON shared_rides (expires_at)
    WHERE dispatched_at IS NULL AND expires_at IS NOT NULL;

-- One row per party (the creator included). Status:
--   joined     — holding seats (pre-dispatch) / riding along (after dispatch, until the end)
--   left       — left before dispatch, seats freed, free (RIDE-P5)
--   cancelled  — cancelled after dispatch: RIDE-07 per member (fee after the grace)
--   no_show    — marked absent by the driver at pickup (UC-D-13 E1): the no-show fee, no share
--   completed  — rode to the end: own share, own payment method, own payment status
CREATE TABLE shared_ride_members (
    shared_ride_member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id               UUID           NOT NULL REFERENCES shared_rides (ride_id),
    rider_user_id         UUID           NOT NULL REFERENCES users (user_id),
    is_creator            BOOLEAN        NOT NULL DEFAULT false,
    party_size            SMALLINT       NOT NULL,
    payment_method        VARCHAR(8)     NOT NULL,
    status                VARCHAR(10)    NOT NULL DEFAULT 'joined',
    joined_at             TIMESTAMPTZ    NOT NULL DEFAULT now(),
    left_at               TIMESTAMPTZ,
    no_show_at            TIMESTAMPTZ,
    cancellation_reason   VARCHAR(24),
    cancellation_note     VARCHAR(500),
    cancellation_fee      NUMERIC(10, 2),
    share_amount          NUMERIC(10, 2),
    payment_status        VARCHAR(12),
    payment_confirmed_at  TIMESTAMPTZ,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT ck_shared_ride_members_party CHECK (party_size BETWEEN 1 AND 8),
    CONSTRAINT ck_shared_ride_members_payment_method
        CHECK (payment_method IN ('cash', 'wallet')),
    CONSTRAINT ck_shared_ride_members_status
        CHECK (status IN ('joined', 'left', 'cancelled', 'no_show', 'completed')),
    CONSTRAINT ck_shared_ride_members_left
        CHECK ((status IN ('left', 'cancelled')) = (left_at IS NOT NULL)),
    CONSTRAINT ck_shared_ride_members_no_show
        CHECK ((status = 'no_show') = (no_show_at IS NOT NULL)),
    CONSTRAINT ck_shared_ride_members_cancellation CHECK (
        (status = 'cancelled') = (cancellation_reason IS NOT NULL)),
    CONSTRAINT ck_shared_ride_members_cancellation_reason CHECK (cancellation_reason IS NULL
        OR cancellation_reason IN ('changed_mind', 'driver_too_far', 'wrong_pickup', 'other')),
    -- Fees only on a post-dispatch cancel (after the grace) or a no-show; never on `left`.
    CONSTRAINT ck_shared_ride_members_fee CHECK (
        cancellation_fee IS NULL
        OR (status IN ('cancelled', 'no_show') AND cancellation_fee > 0)),
    CONSTRAINT ck_shared_ride_members_share CHECK (
        (status = 'completed') = (share_amount IS NOT NULL AND payment_status IS NOT NULL)
        AND (share_amount IS NULL OR share_amount >= 0)),
    CONSTRAINT ck_shared_ride_members_payment_status CHECK (payment_status IS NULL
        OR payment_status IN ('pending', 'paid_cash', 'paid_wallet', 'paid_mixed', 'unpaid')),
    CONSTRAINT ck_shared_ride_members_payment_confirmed CHECK (
        (payment_confirmed_at IS NOT NULL)
            = (payment_status IN ('paid_cash', 'paid_wallet', 'paid_mixed', 'unpaid')))
);

-- One creator per shared ride; a rider holds at most one live membership per ride (a member
-- who left before dispatch may join again while seats remain).
CREATE UNIQUE INDEX uq_shared_ride_members_creator ON shared_ride_members (ride_id)
    WHERE is_creator;
CREATE UNIQUE INDEX uq_shared_ride_members_live ON shared_ride_members (ride_id, rider_user_id)
    WHERE status IN ('joined', 'completed');
CREATE INDEX idx_shared_ride_members_rider ON shared_ride_members (rider_user_id, joined_at DESC);

-- RIDE-P4 money and ratings per member: the per-ride uniques of V12/V17 assumed ONE rider.
-- They now hold per ride x member; for an on-demand or scheduled ride (member NULL, one rider)
-- they mean exactly what they meant before.
ALTER TABLE driver_ledger
    ADD COLUMN shared_ride_member_id UUID REFERENCES shared_ride_members (shared_ride_member_id);
DROP INDEX uq_driver_ledger_ride_fare;
DROP INDEX uq_driver_ledger_ride_tip;
DROP INDEX uq_driver_ledger_ride_cancellation;
CREATE UNIQUE INDEX uq_driver_ledger_ride_fare
    ON driver_ledger (ride_id, shared_ride_member_id) NULLS NOT DISTINCT
    WHERE type IN ('ride_earning', 'commission_due');
CREATE UNIQUE INDEX uq_driver_ledger_ride_tip
    ON driver_ledger (ride_id, shared_ride_member_id) NULLS NOT DISTINCT
    WHERE type = 'tip';
CREATE UNIQUE INDEX uq_driver_ledger_ride_cancellation
    ON driver_ledger (ride_id, shared_ride_member_id) NULLS NOT DISTINCT
    WHERE type = 'cancellation_fee';

-- One tip per ride per tipping rider (each member tips on their own).
DROP INDEX uq_wallet_transactions_tip;
CREATE UNIQUE INDEX uq_wallet_transactions_tip ON wallet_transactions (ride_id, user_id)
    WHERE type = 'tip';

-- One due per cancelled ride per rider (several members of one shared ride may each owe a fee).
ALTER TABLE rider_dues
    DROP CONSTRAINT uq_rider_dues_source;
ALTER TABLE rider_dues
    ADD CONSTRAINT uq_rider_dues_source UNIQUE (source_ride_id, rider_user_id);

-- RATE-01 per member: each member rates the driver and the driver may rate each member — one
-- rating per ride per rater -> rated pair (on a one-rider ride: one per side, as before).
ALTER TABLE ratings
    DROP CONSTRAINT uq_ratings_ride_rater_role;
ALTER TABLE ratings
    ADD CONSTRAINT uq_ratings_ride_rater_rated UNIQUE (ride_id, rater_user_id, rated_user_id);

-- RIDE-S timing per region (SRS §9 "mostly per region"); NULL = the SRS defaults
-- {"reminderFirstMin": 1440, "reminderSecondMin": 60, "fallbackLeadMin": 15, "minLeadMin": 30}.
-- Shape and ordering are validated by the service (same rule as metric_warnings).
ALTER TABLE regions
    ADD COLUMN scheduled_settings JSONB,
    ADD CONSTRAINT ck_regions_scheduled_settings
        CHECK (scheduled_settings IS NULL OR jsonb_typeof(scheduled_settings) = 'object');
