-- Owner ruling 2026-10-15 (M10 review A-H1): the Support role handles SOS from the
-- live ops map, which picks its region from GET /admin/regions (regions:view).
-- Grant Support regions:view; idempotent like the V4 seed.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
         JOIN permissions p ON p.code = 'regions:view'
WHERE r.name = 'Support'
ON CONFLICT DO NOTHING;
