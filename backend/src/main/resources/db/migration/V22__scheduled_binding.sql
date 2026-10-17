-- M12 review fixes (docs/reviews/review-M12.md H1, W3; owner rulings 2026-10-17).
-- H1: a driver is bound to at most ONE live ride. Two paths bind a driver — accepting a live offer
-- and the scheduled conversion at T - lead (which first withdraws the claimer's open offer) — and
-- accept refuses a driver already on an assigned ride; this index is the database backstop.
CREATE UNIQUE INDEX uq_rides_driver_assigned ON rides (driver_user_id)
    WHERE state IN ('accepted', 'driver_arrived', 'in_progress');

-- W3: at conversion the claim follows the driver's CURRENT active vehicle when it still serves the
-- ride's service type; otherwise the system releases the claim as `vehicle_changed` — never
-- chosen, not a cancellation-metric event (like `account_suspended`).
ALTER TABLE scheduled_claim_releases
    DROP CONSTRAINT ck_scheduled_claim_releases_reason;
ALTER TABLE scheduled_claim_releases
    ADD CONSTRAINT ck_scheduled_claim_releases_reason
        CHECK (reason IN ('vehicle_issue', 'unsafe_pickup', 'other', 'account_suspended',
                          'vehicle_changed'));
