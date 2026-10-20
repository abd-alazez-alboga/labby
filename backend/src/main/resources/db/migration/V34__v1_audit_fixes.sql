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

-- W30 (owner ruling 2026-10-20, PAY-02): a driver's mark-unpaid opens a payment support ticket
-- automatically, in this system category (permanent and always active, like `lost_item`; users
-- never pick it themselves).
INSERT INTO ticket_categories (ticket_category_id, system_code, name_en, name_ar, default_priority,
                               sort_order)
VALUES ('00000000-0000-0000-0000-000000001402', 'unpaid_ride', 'Unpaid ride', 'رحلة غير مدفوعة',
        'normal', 1001);
