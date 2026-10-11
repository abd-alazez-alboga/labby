-- M8: money rails (PAY-01..04, COM-01..04, PRC-03 collection; UC-R-07/08/17, UC-D-15/16,
-- UC-A-15/27). Contract: docs/api/money-v1.yaml.
-- Owner rulings (2026-10-11): rider cancellation fees go 100% to the assigned driver,
-- commission-free; a fee a wallet cannot cover (and every fee on a cash-method ride) is carried
-- as a rider due and added to the rider's NEXT completed ride; fees already recorded by M7 are
-- collected retroactively (backfilled below). Settlements record any positive amount (off-app
-- truth; corrections = counter-settlement, never edits). Derived amounts round HALF_UP to
-- 2 decimals; storage is exact NUMERIC, currency-tagged. Driver balances are per currency; the
-- floor is per region (COM-03 default -50) and dispatch compares the ride region's floor against
-- the driver's balance in that region's currency. One tip per ride. Commission rates are tracked
-- per driver x region x week (Monday start, region time zone), from the PREVIOUS week's
-- completed trips in that region (COM-02).

-- Ledgers (wallet_transactions, driver_ledger, settlements) are APPEND-ONLY: the trigger blocks
-- every UPDATE and DELETE at the database, like audit_log (V4). Balances are transactional
-- caches of their ledger sums; the sum invariant is test-enforced.
CREATE FUNCTION money_block_mutation() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

-- PAY-01: one wallet per account with per-currency balances, never negative, no top-ups.
-- The row is created on first credit and updated in the same transaction as its ledger entry.
CREATE TABLE wallet_balances (
    user_id    UUID           NOT NULL REFERENCES users (user_id),
    currency   VARCHAR(3)     NOT NULL,
    balance    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ    NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, currency),
    CONSTRAINT ck_wallet_balances_non_negative CHECK (balance >= 0)
);

-- UC-R-17 typed history. Signed amounts: credits > 0 (refund, admin_grant, and the M13 sources
-- referral/promo/loyalty_redemption — the wallet accepts them now), debits < 0 (fare_payment,
-- tip, cancellation_fee). balance_after = the wallet balance in that currency after this entry.
CREATE TABLE wallet_transactions (
    wallet_transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID           NOT NULL REFERENCES users (user_id),
    currency              VARCHAR(3)     NOT NULL,
    amount                NUMERIC(12, 2) NOT NULL,
    type                  VARCHAR(20)    NOT NULL,
    ride_id               UUID REFERENCES rides (ride_id),
    -- PAY-03: grants/refunds are admin-issued, reasoned, audited; refunds are ride-linked
    -- (support-ticket links arrive with M14).
    created_by            UUID REFERENCES users (user_id),
    reason                VARCHAR(500),
    balance_after         NUMERIC(12, 2) NOT NULL,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT ck_wallet_transactions_type CHECK (type IN ('fare_payment', 'tip',
        'cancellation_fee', 'refund', 'admin_grant', 'referral', 'promo', 'loyalty_redemption')),
    CONSTRAINT ck_wallet_transactions_amount CHECK (amount <> 0),
    CONSTRAINT ck_wallet_transactions_sign CHECK (
        (type IN ('refund', 'admin_grant', 'referral', 'promo', 'loyalty_redemption')
            AND amount > 0)
        OR (type IN ('fare_payment', 'tip', 'cancellation_fee') AND amount < 0)),
    CONSTRAINT ck_wallet_transactions_balance CHECK (balance_after >= 0),
    CONSTRAINT ck_wallet_transactions_admin CHECK (
        type NOT IN ('refund', 'admin_grant')
        OR (created_by IS NOT NULL AND reason IS NOT NULL)),
    CONSTRAINT ck_wallet_transactions_refund_link CHECK (type <> 'refund' OR ride_id IS NOT NULL),
    CONSTRAINT ck_wallet_transactions_ride_types CHECK (
        type NOT IN ('fare_payment', 'tip', 'cancellation_fee') OR ride_id IS NOT NULL)
);

CREATE TRIGGER trg_wallet_transactions_append_only
    BEFORE UPDATE OR DELETE
    ON wallet_transactions
    FOR EACH ROW
EXECUTE FUNCTION money_block_mutation();

CREATE INDEX idx_wallet_transactions_user ON wallet_transactions (user_id, created_at DESC);
CREATE INDEX idx_wallet_transactions_ride ON wallet_transactions (ride_id)
    WHERE ride_id IS NOT NULL;
-- PAY-04 + owner ruling: at most one tip per ride.
CREATE UNIQUE INDEX uq_wallet_transactions_tip ON wallet_transactions (ride_id)
    WHERE type = 'tip';

-- COM-04 / UC-A-27: the immutable record of off-app money movement. pay_in = driver hands cash
-- (settles commission debt), pay_out = positive balance paid out. A mistake is corrected by a
-- counter-settlement. Each settlement posts exactly one driver_ledger entry (FK below).
CREATE TABLE settlements (
    settlement_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_user_id UUID           NOT NULL REFERENCES users (user_id),
    currency       VARCHAR(3)     NOT NULL,
    amount         NUMERIC(12, 2) NOT NULL,
    direction      VARCHAR(8)     NOT NULL,
    note           VARCHAR(500),
    recorded_by    UUID           NOT NULL REFERENCES users (user_id),
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT ck_settlements_amount CHECK (amount > 0),
    CONSTRAINT ck_settlements_direction CHECK (direction IN ('pay_in', 'pay_out'))
);

CREATE TRIGGER trg_settlements_append_only
    BEFORE UPDATE OR DELETE
    ON settlements
    FOR EACH ROW
EXECUTE FUNCTION money_block_mutation();

CREATE INDEX idx_settlements_driver ON settlements (driver_user_id, created_at DESC);

-- COM-01 itemized driver earnings ledger. Signed amounts: ride_earning (wallet-paid fare minus
-- commission), tip, cancellation_fee (100% of the rider's fee, commission-free — owner ruling;
-- credited ONCE, when the fee is fully collected), settlement_pay_in and bonus (DRV-08 seam,
-- M13/M15) credit > 0; commission_due (cash ride: driver kept the cash, owes the commission),
-- settlement_pay_out and due_collection debit < 0. due_collection: a rider due was collected in
-- CASH on a later ride — its driver pocketed the extra cash on the platform's behalf and owes
-- it (the fee credit goes to the CANCELLED ride's driver); ride_id = the collecting ride,
-- rider_due_id = the due.
CREATE TABLE driver_ledger (
    driver_ledger_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_user_id    UUID           NOT NULL REFERENCES users (user_id),
    currency          VARCHAR(3)     NOT NULL,
    amount            NUMERIC(12, 2) NOT NULL,
    type              VARCHAR(20)    NOT NULL,
    ride_id           UUID REFERENCES rides (ride_id),
    settlement_id     UUID REFERENCES settlements (settlement_id),
    rider_due_id      UUID,
    -- Itemization (UC-D-15): the fare and the commission applied, on every ride money entry.
    fare_amount       NUMERIC(10, 2),
    commission_rate   NUMERIC(5, 2),
    commission_amount NUMERIC(10, 2),
    balance_after     NUMERIC(12, 2) NOT NULL,
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT ck_driver_ledger_type CHECK (type IN ('ride_earning', 'commission_due', 'tip',
        'cancellation_fee', 'settlement_pay_in', 'settlement_pay_out', 'bonus',
        'due_collection')),
    CONSTRAINT ck_driver_ledger_amount CHECK (amount <> 0),
    CONSTRAINT ck_driver_ledger_sign CHECK (
        (type IN ('ride_earning', 'tip', 'cancellation_fee', 'settlement_pay_in', 'bonus')
            AND amount > 0)
        OR (type IN ('commission_due', 'settlement_pay_out', 'due_collection') AND amount < 0)),
    -- Ride money entries carry their ride and, for earnings/commission, the full itemization.
    CONSTRAINT ck_driver_ledger_ride CHECK (
        type NOT IN ('ride_earning', 'commission_due', 'tip', 'cancellation_fee',
                     'due_collection')
        OR ride_id IS NOT NULL),
    CONSTRAINT ck_driver_ledger_due CHECK (
        type = 'due_collection' OR type = 'cancellation_fee' OR rider_due_id IS NULL),
    CONSTRAINT ck_driver_ledger_due_collection CHECK (
        type <> 'due_collection' OR rider_due_id IS NOT NULL),
    CONSTRAINT ck_driver_ledger_itemized CHECK (
        (type IN ('ride_earning', 'commission_due'))
            = (fare_amount IS NOT NULL AND commission_rate IS NOT NULL
               AND commission_amount IS NOT NULL)),
    -- Settlement entries are 1:1 with their settlements row; nothing else references one.
    CONSTRAINT ck_driver_ledger_settlement CHECK (
        (type IN ('settlement_pay_in', 'settlement_pay_out')) = (settlement_id IS NOT NULL))
);

CREATE TRIGGER trg_driver_ledger_append_only
    BEFORE UPDATE OR DELETE
    ON driver_ledger
    FOR EACH ROW
EXECUTE FUNCTION money_block_mutation();

CREATE INDEX idx_driver_ledger_driver ON driver_ledger (driver_user_id, created_at DESC);
CREATE INDEX idx_driver_ledger_ride ON driver_ledger (ride_id) WHERE ride_id IS NOT NULL;
CREATE UNIQUE INDEX uq_driver_ledger_settlement ON driver_ledger (settlement_id)
    WHERE settlement_id IS NOT NULL;
-- A completed ride posts exactly one fare entry (earning OR commission debit) and at most one
-- tip / one cancellation-fee credit.
CREATE UNIQUE INDEX uq_driver_ledger_ride_fare ON driver_ledger (ride_id)
    WHERE type IN ('ride_earning', 'commission_due');
CREATE UNIQUE INDEX uq_driver_ledger_ride_tip ON driver_ledger (ride_id) WHERE type = 'tip';
CREATE UNIQUE INDEX uq_driver_ledger_ride_cancellation ON driver_ledger (ride_id)
    WHERE type = 'cancellation_fee';

-- The driver's running balance per currency (COM-03 floor checks on the dispatch hot path).
-- May be negative (cash commission debt), unlike wallets.
CREATE TABLE driver_balances (
    driver_user_id UUID           NOT NULL REFERENCES users (user_id),
    currency       VARCHAR(3)     NOT NULL,
    balance        NUMERIC(12, 2) NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
    PRIMARY KEY (driver_user_id, currency)
);

-- COM-02: the commission rate applied during week_start's week (Monday, region time zone),
-- recalculated weekly from the previous week's completed trips in that region. The weekly job
-- inserts the new week's row; a missing row means the region's base tier applies.
CREATE TABLE driver_commission_rates (
    driver_commission_rate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_user_id            UUID          NOT NULL REFERENCES users (user_id),
    region_id                 UUID          NOT NULL REFERENCES regions (region_id),
    week_start                DATE          NOT NULL,
    percent                   NUMERIC(5, 2) NOT NULL,
    weekly_trips              INTEGER       NOT NULL,
    computed_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT uq_driver_commission_rates UNIQUE (driver_user_id, region_id, week_start),
    CONSTRAINT ck_driver_commission_rates_percent CHECK (percent >= 0 AND percent <= 100),
    CONSTRAINT ck_driver_commission_rates_trips CHECK (weekly_trips >= 0)
);

-- Owner ruling (a): a cancellation fee the wallet could not cover (and every fee on a
-- cash-method ride) is carried here and added to the rider's NEXT completed ride. Workflow row,
-- not a ledger — the money truth lands in wallet_transactions / driver_ledger at collection.
CREATE TABLE rider_dues (
    rider_due_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_user_id     UUID           NOT NULL REFERENCES users (user_id),
    currency          VARCHAR(3)     NOT NULL,
    amount            NUMERIC(10, 2) NOT NULL,
    type              VARCHAR(20)    NOT NULL DEFAULT 'cancellation_fee',
    source_ride_id    UUID           NOT NULL REFERENCES rides (ride_id),
    status            VARCHAR(10)    NOT NULL DEFAULT 'pending',
    collected_ride_id UUID REFERENCES rides (ride_id),
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
    collected_at      TIMESTAMPTZ,
    CONSTRAINT uq_rider_dues_source UNIQUE (source_ride_id),
    CONSTRAINT ck_rider_dues_amount CHECK (amount > 0),
    CONSTRAINT ck_rider_dues_type CHECK (type IN ('cancellation_fee')),
    CONSTRAINT ck_rider_dues_status CHECK (status IN ('pending', 'collected')),
    CONSTRAINT ck_rider_dues_collected CHECK (
        (status = 'collected')
            = (collected_ride_id IS NOT NULL AND collected_at IS NOT NULL))
);

CREATE INDEX idx_rider_dues_pending ON rider_dues (rider_user_id) WHERE status = 'pending';

-- rider_dues is created after driver_ledger, so the ledger's due link lands here.
ALTER TABLE driver_ledger
    ADD CONSTRAINT fk_driver_ledger_rider_due
        FOREIGN KEY (rider_due_id) REFERENCES rider_dues (rider_due_id);
-- A due is collected (and cash-debited to the collecting driver) at most once.
CREATE UNIQUE INDEX uq_driver_ledger_due_collection ON driver_ledger (rider_due_id)
    WHERE type = 'due_collection';

-- Owner ruling (2): fees M7 recorded but never collected become pending dues retroactively.
-- (Wallet-first collection only applies from M8 on; nothing was debited for these.)
INSERT INTO rider_dues (rider_user_id, currency, amount, type, source_ride_id, status)
SELECT rider_user_id, currency, cancellation_fee, 'cancellation_fee', ride_id, 'pending'
FROM rides
WHERE cancellation_fee IS NOT NULL;

-- COM-03: the floor is a region bundle scalar like the other money settings; NULL means the
-- SRS default (-50). 0 = no debt allowed; it is never positive.
ALTER TABLE regions
    ADD COLUMN driver_balance_floor NUMERIC(10, 2),
    ADD CONSTRAINT ck_regions_driver_balance_floor
        CHECK (driver_balance_floor IS NULL OR driver_balance_floor <= 0);

-- PAY-02: wallet and mixed payment arrive. paid_wallet = fare fully covered by the wallet at
-- completion (auto-confirmed); paid_mixed = wallet drained + cash remainder confirmed by the
-- driver. pending still resolves via the M7 cash-confirm / mark-unpaid endpoints.
ALTER TABLE rides
    DROP CONSTRAINT ck_rides_payment_status;
ALTER TABLE rides
    ADD CONSTRAINT ck_rides_payment_status CHECK (
        (payment_status IS NULL AND state <> 'completed')
        OR (state = 'completed'
            AND payment_status IN ('pending', 'paid_cash', 'paid_wallet', 'paid_mixed',
                                   'unpaid')));
ALTER TABLE rides
    DROP CONSTRAINT ck_rides_payment_confirmed;
ALTER TABLE rides
    ADD CONSTRAINT ck_rides_payment_confirmed CHECK (
        (payment_confirmed_at IS NOT NULL)
            = (payment_status IN ('paid_cash', 'paid_wallet', 'paid_mixed', 'unpaid')));
