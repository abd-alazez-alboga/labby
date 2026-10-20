-- V1 conformance audit (2026-10-20) backend fixes.

-- H7 (owner ruling 2026-10-20: the COM-03 floor blocks scheduled rides too): at conversion the
-- system releases the claim of a driver at/below the balance floor as `balance_below_floor` —
-- never chosen, not a cancellation-metric event (like `account_suspended` / `vehicle_changed`).
ALTER TABLE scheduled_claim_releases
    DROP CONSTRAINT ck_scheduled_claim_releases_reason;
ALTER TABLE scheduled_claim_releases
    ADD CONSTRAINT ck_scheduled_claim_releases_reason
        CHECK (reason IN ('vehicle_issue', 'unsafe_pickup', 'other', 'account_suspended',
                          'vehicle_changed', 'balance_below_floor'));
