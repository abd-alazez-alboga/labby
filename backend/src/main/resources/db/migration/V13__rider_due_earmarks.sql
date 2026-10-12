-- M8 audit fixes (owner rulings 2026-10-12). Contract: docs/api/money-v1.yaml, rides-v1.yaml.

-- H3: a rider due carried in CASH is only EARMARKED at the carrying ride's completion — no money
-- moves until the driver confirms the cash (then due_collection + the cancelled ride's driver's
-- cancellation_fee credit, and the due becomes collected). Mark-unpaid releases the earmark: the
-- due is pending again and the rider's next same-currency ride carries it. An earmark only ever
-- sits on a pending due; a collected due points at its ride through collected_ride_id instead.
ALTER TABLE rider_dues
    ADD COLUMN collecting_ride_id UUID REFERENCES rides (ride_id),
    ADD CONSTRAINT ck_rider_dues_collecting CHECK (
        collecting_ride_id IS NULL OR status = 'pending');

CREATE INDEX idx_rider_dues_collecting ON rider_dues (collecting_ride_id)
    WHERE collecting_ride_id IS NOT NULL;

-- I3: the ride monitor's once-only wait-notice guard looks the outbox up by event + the ride id
-- in its params on every tick (NotificationOutboxRepository.existsByEventAndRideId). The partial
-- predicate is implied by the lookup's equality, so the planner can use the index.
CREATE INDEX idx_notification_outbox_event_ride
    ON notification_outbox (event, (params ->> 'rideId'))
    WHERE (params ->> 'rideId') IS NOT NULL;
