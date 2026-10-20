-- Review V1 W3 (owner ruling 2026-10-20): the COM-03 debt floor and the floor-warning margin are
-- per-region amounts in the region's currency. The floor already lives on regions
-- (driver_balance_floor, V12); the margin joins it. NULL = the global MONEY_FLOOR_WARNING_MARGIN
-- (default 10), so existing regions keep today's behaviour until an admin sets it.
ALTER TABLE regions
    ADD COLUMN floor_warning_margin NUMERIC(10, 2),
    ADD CONSTRAINT ck_regions_floor_warning_margin
        CHECK (floor_warning_margin IS NULL OR floor_warning_margin > 0);

-- Review V1 W39 (UC-R-04 E3: a suspended rider gets appeal info): the suspended screens' "Contact
-- support" opens a ticket pre-filled in this category, which the apps find by system_code in
-- GET /support/ticket-categories. Unlike lost_item (system-opened only), users may pick it. Being
-- a system row it is protected by the V26 trigger: never deactivated, never deleted. Idempotent.
INSERT INTO ticket_categories (ticket_category_id, system_code, name_en, name_ar, default_priority,
                               active)
VALUES ('00000000-0000-0000-0000-000000001403', 'account_suspend', 'Account & suspension',
        'الحساب والإيقاف', 'normal', TRUE)
ON CONFLICT DO NOTHING;
