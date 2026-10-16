-- M12-T2: owner ruling 2026-10-16 (scheduled-shared-v1.yaml) — a scheduled ride whose rider is
-- still on another live ride at its conversion/fallback moment is cancelled by the system, free
-- (`rider_busy`, never chosen by a party — like `account_suspended` and `shared_expired`).
ALTER TABLE rides
    DROP CONSTRAINT ck_rides_cancellation_reason;
ALTER TABLE rides
    ADD CONSTRAINT ck_rides_cancellation_reason CHECK (cancellation_reason IS NULL
        OR cancellation_reason IN ('changed_mind', 'driver_too_far', 'wrong_pickup',
            'rider_no_show', 'vehicle_issue', 'unsafe_pickup', 'other', 'account_suspended',
            'shared_expired', 'rider_busy'));
