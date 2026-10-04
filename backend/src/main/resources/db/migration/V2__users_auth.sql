-- M2: identity & authentication (AUTH-01..07, USR-01..07, ES-02).
-- NOTE: users deliberately do NOT use the hide-on-soft-delete pattern
-- (@SQLDelete/@SQLRestriction): deletion is a domain STATE (`deleted`) because
-- re-registration must find and reactivate the row (USR-07). deleted_at is
-- kept as an audit timestamp only.

CREATE TABLE users (
    user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         VARCHAR(20)  NOT NULL,
    password_hash TEXT         NOT NULL,
    name          VARCHAR(100) NOT NULL,
    photo_path    TEXT,
    language      VARCHAR(2)   NOT NULL DEFAULT 'en',
    state         VARCHAR(16)  NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_by    UUID,
    deleted_at    TIMESTAMPTZ,
    CONSTRAINT uq_users_phone UNIQUE (phone),
    CONSTRAINT ck_users_state CHECK (state IN ('active', 'suspended', 'deleted')),
    CONSTRAINT ck_users_language CHECK (language IN ('en', 'ar'))
);

CREATE TABLE role_assignments (
    role_assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID        NOT NULL REFERENCES users (user_id),
    role               VARCHAR(16) NOT NULL,
    state              VARCHAR(16) NOT NULL DEFAULT 'active',
    granted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_role_assignments_user_role UNIQUE (user_id, role),
    CONSTRAINT ck_role_assignments_role CHECK (role IN ('rider', 'driver', 'admin')),
    CONSTRAINT ck_role_assignments_state CHECK (state IN ('active', 'suspended'))
);

CREATE INDEX idx_role_assignments_user ON role_assignments (user_id);

-- One-time codes are stored HASHED and bound to the operation that issued
-- them (purpose), per AUTH-04.
CREATE TABLE otp_codes (
    otp_code_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone       VARCHAR(20) NOT NULL,
    code_hash   TEXT        NOT NULL,
    purpose     VARCHAR(16) NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    attempts    INT         NOT NULL DEFAULT 0,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_otp_codes_purpose CHECK (purpose IN ('register', 'reset', '2fa'))
);

CREATE INDEX idx_otp_codes_phone_purpose ON otp_codes (phone, purpose, created_at);

-- Refresh tokens are stored hashed; rotation revokes the old row (NFR-S1).
CREATE TABLE refresh_tokens (
    refresh_token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users (user_id),
    token_hash       TEXT        NOT NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    revoked_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash)
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
