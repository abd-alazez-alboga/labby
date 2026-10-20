-- M15 review W16 (NFR-P4 "stateless API, no instance-local state"; CON-06 keeps horizontal
-- scaling open): the two pieces of auth state the API used to hold in memory move to the
-- database, so a restart or a second instance sees the same state.

-- The multi-step phone change in progress (ES-02, AUTH-05): at most one per account. Nothing
-- about the account mutates until the final step; an expired row is ignored and replaced by the
-- next start (or deleted when a step finds it stale).
CREATE TABLE phone_change_sessions (
    user_id    UUID        PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
    new_phone  VARCHAR(20) NOT NULL,
    -- awaiting_current: OTP sent to the current phone; awaiting_new: OTP sent to the new one.
    stage      VARCHAR(16) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_phone_change_sessions_stage CHECK (stage IN ('awaiting_current', 'awaiting_new'))
);

-- Fixed-window failed-login counters per phone + client IP (NFR-S3). One upsert per failed
-- attempt opens or extends the window; a successful login deletes the row; a row whose window
-- has passed no longer throttles and is restarted by the next failure. No FK: the phone of a
-- failed login need not belong to an account.
CREATE TABLE login_failures (
    login_failure_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone            VARCHAR(20) NOT NULL,
    client_ip        TEXT        NOT NULL,
    window_start     TIMESTAMPTZ NOT NULL,
    failures         INTEGER     NOT NULL,
    CONSTRAINT uq_login_failures_key UNIQUE (phone, client_ip),
    CONSTRAINT ck_login_failures_failures CHECK (failures > 0)
);
