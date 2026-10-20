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

-- W40 (owner ruling 2026-10-20, UC-R-06 step 3): the rider is notified when the expected arrival
-- slips by 5+ minutes over the last one they were told, at most once per 5 minutes.
ALTER TABLE rides
    ADD COLUMN eta_baseline_arrival_at TIMESTAMPTZ,
    ADD COLUMN eta_delay_notified_at   TIMESTAMPTZ;

-- I2 (SRS §5 / §5.5: money and audit tables are append-only): the loyalty points ledger and the
-- incentive awards get the same database backstop as the V12 money ledgers. promo_redemptions is
-- deliberately NOT guarded: it is a reservation table — the amount is finalized at completion and a
-- leaving member's reservation is deleted (M13 rulings), so it is mutable by design.
CREATE TRIGGER trg_points_transactions_append_only
    BEFORE UPDATE OR DELETE
    ON points_transactions
    FOR EACH ROW
EXECUTE FUNCTION money_block_mutation();

CREATE TRIGGER trg_incentive_awards_append_only
    BEFORE UPDATE OR DELETE
    ON incentive_awards
    FOR EACH ROW
EXECUTE FUNCTION money_block_mutation();

-- I20 (GRW-03 "a reactivated deleted account is not a new user"): the moment a deleted account is
-- reactivated (re-registration, USR-07) is recorded by the database itself, so the referral
-- primitive can refuse such an account even before its first ride.
ALTER TABLE users
    ADD COLUMN reactivated_at TIMESTAMPTZ;

CREATE FUNCTION users_mark_reactivated() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    IF OLD.state = 'deleted' AND NEW.state = 'active' THEN
        NEW.reactivated_at := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_mark_reactivated
    BEFORE UPDATE OF state
    ON users
    FOR EACH ROW
EXECUTE FUNCTION users_mark_reactivated();
