-- M13-T2, owner ruling 1 (2026-10-18): a promo is platform-funded — commission is computed on the
-- PRE-discount fare and the discount reaches the ride's driver as its own positive, ride-linked
-- ledger entry, so driver earnings on a promo ride equal those without the promo.
ALTER TABLE driver_ledger
    DROP CONSTRAINT ck_driver_ledger_type;
ALTER TABLE driver_ledger
    ADD CONSTRAINT ck_driver_ledger_type CHECK (type IN ('ride_earning', 'commission_due', 'tip',
        'cancellation_fee', 'settlement_pay_in', 'settlement_pay_out', 'bonus',
        'due_collection', 'promo_compensation'));
ALTER TABLE driver_ledger
    DROP CONSTRAINT ck_driver_ledger_sign;
ALTER TABLE driver_ledger
    ADD CONSTRAINT ck_driver_ledger_sign CHECK (
        (type IN ('ride_earning', 'tip', 'cancellation_fee', 'settlement_pay_in', 'bonus',
                  'promo_compensation')
            AND amount > 0)
        OR (type IN ('commission_due', 'settlement_pay_out', 'due_collection') AND amount < 0));
ALTER TABLE driver_ledger
    DROP CONSTRAINT ck_driver_ledger_ride;
ALTER TABLE driver_ledger
    ADD CONSTRAINT ck_driver_ledger_ride CHECK (
        type NOT IN ('ride_earning', 'commission_due', 'tip', 'cancellation_fee',
                     'due_collection', 'promo_compensation')
            OR ride_id IS NOT NULL);

-- One compensation per ride (one promo per ride, never stacked).
CREATE UNIQUE INDEX uq_driver_ledger_ride_promo ON driver_ledger (ride_id)
    WHERE type = 'promo_compensation';
