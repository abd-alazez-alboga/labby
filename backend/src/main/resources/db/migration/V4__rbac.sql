-- M3: admin RBAC & audit log (RBAC-01..05, AUTH-06; SRS §5.1 3-table model).
-- Catalog source of truth is code (enums/Permission.java, synced idempotently by
-- runner/RbacCatalogSeeder); this migration seeds catalog v1 so system-role grants
-- and the admin-role backfill can happen atomically with the schema. All seeds are
-- idempotent. Future permissions arrive via later migrations + catalog additions.

CREATE TABLE roles (
    role_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(50) NOT NULL,
    is_system  BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT uq_roles_name UNIQUE (name)
);

CREATE TABLE permissions (
    permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(64) NOT NULL,
    domain        VARCHAR(32) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_permissions_code UNIQUE (code),
    CONSTRAINT ck_permissions_code CHECK (code ~ '^[a-z][a-z-]*:[a-z][a-z-]*$')
);

CREATE TABLE role_permissions (
    role_id       UUID        NOT NULL REFERENCES roles (role_id),
    permission_id UUID        NOT NULL REFERENCES permissions (permission_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

-- Append-only audit trail of admin actions (RBAC-05). UPDATE/DELETE are blocked
-- at the DB level; retention is forever (SRS §5).
CREATE TABLE audit_log (
    audit_log_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID        NOT NULL REFERENCES users (user_id),
    action        VARCHAR(64) NOT NULL,
    target_type   VARCHAR(32),
    target_id     VARCHAR(64),
    before_state  JSONB,
    after_state   JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_actor ON audit_log (actor_user_id, created_at);
CREATE INDEX idx_audit_log_target ON audit_log (target_type, target_id, created_at);
CREATE INDEX idx_audit_log_created ON audit_log (created_at);

CREATE FUNCTION audit_log_block_mutation() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE TRIGGER trg_audit_log_append_only
    BEFORE UPDATE OR DELETE
    ON audit_log
    FOR EACH ROW
EXECUTE FUNCTION audit_log_block_mutation();

-- System roles with fixed ids so seeds and backfills can reference them.
INSERT INTO roles (role_id, name, is_system)
VALUES ('00000000-0000-0000-0000-000000000001', 'Super Admin', true),
       ('00000000-0000-0000-0000-000000000002', 'Support', true)
ON CONFLICT (name) DO NOTHING;

-- Permission catalog v1 — MUST mirror enums/Permission.java verbatim.
INSERT INTO permissions (code, domain)
VALUES ('users:view', 'users'),
       ('users:suspend', 'users'),
       ('rides:view', 'rides'),
       ('regions:view', 'regions'),
       ('regions:edit', 'regions'),
       ('pricing:view', 'pricing'),
       ('pricing:edit', 'pricing'),
       ('driver-review:view', 'driver-review'),
       ('driver-review:decide', 'driver-review'),
       ('support:view', 'support'),
       ('support:handle', 'support'),
       ('settlements:view', 'settlements'),
       ('settlements:record', 'settlements'),
       ('promos:view', 'promos'),
       ('promos:manage', 'promos'),
       ('analytics:view', 'analytics'),
       ('analytics:export', 'analytics'),
       ('audit:view', 'audit'),
       ('admins:view', 'admins'),
       ('admins:manage', 'admins'),
       ('roles:view', 'roles'),
       ('roles:manage', 'roles')
ON CONFLICT (code) DO NOTHING;

-- Super Admin holds every permission (RBAC-01; kept complete by RbacCatalogSeeder).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
         CROSS JOIN permissions p
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;

-- Support default grants (RBAC-04): ride/user read + ticket/report/lost-item
-- handling; no system config, no financial config. Editable afterwards — the
-- seeder never re-touches Support.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
         JOIN permissions p ON p.code IN ('users:view', 'rides:view', 'support:view', 'support:handle')
WHERE r.name = 'Support'
ON CONFLICT DO NOTHING;

-- Each admin references exactly ONE role (SRS §5.1), carried on the admin
-- role_assignments row. Existing admins (dev seeds; no creation endpoint
-- existed before M3) become Super Admins.
ALTER TABLE role_assignments
    ADD COLUMN admin_role_id UUID REFERENCES roles (role_id);

UPDATE role_assignments
SET admin_role_id = '00000000-0000-0000-0000-000000000001'
WHERE role = 'admin'
  AND admin_role_id IS NULL;

ALTER TABLE role_assignments
    ADD CONSTRAINT ck_role_assignments_admin_role
        CHECK ((role = 'admin') = (admin_role_id IS NOT NULL));

CREATE INDEX idx_role_assignments_admin_role ON role_assignments (admin_role_id);
