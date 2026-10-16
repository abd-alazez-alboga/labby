-- M11 review rulings (2026-10-16, docs/reviews/review-M11.md). Contract: docs/api/trust-v1.yaml.

-- B-H1: USR-05 runs in the daily job, not on each rating. After an admin reactivates a role, the
-- job may suspend it again only once a rating was stored AFTER this moment.
ALTER TABLE role_assignments
    ADD COLUMN reactivated_at TIMESTAMPTZ;

-- B-W5: a whole-account suspension system-cancels the account's pre-acceptance requests
-- (state cancelled_by_rider, no fee) with their own reason.
ALTER TABLE rides
    DROP CONSTRAINT ck_rides_cancellation_reason;
ALTER TABLE rides
    ADD CONSTRAINT ck_rides_cancellation_reason CHECK (cancellation_reason IS NULL
        OR cancellation_reason IN ('changed_mind', 'driver_too_far', 'wrong_pickup',
            'rider_no_show', 'vehicle_issue', 'unsafe_pickup', 'other', 'account_suspended'));

-- B-I1: the hourly DRV-07 job's candidate query scans offers and accepted rides by moment.
CREATE INDEX idx_ride_offers_offered_at ON ride_offers (offered_at);
CREATE INDEX idx_rides_accepted_at ON rides (accepted_at) WHERE accepted_at IS NOT NULL;
