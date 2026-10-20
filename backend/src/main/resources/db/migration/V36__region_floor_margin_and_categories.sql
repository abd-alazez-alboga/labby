-- Review V1 W3 (owner ruling 2026-10-20): the COM-03 debt floor and the floor-warning margin are
-- per-region amounts in the region's currency. The floor already lives on regions
-- (driver_balance_floor, V12); the margin joins it. NULL = the global MONEY_FLOOR_WARNING_MARGIN
-- (default 10), so existing regions keep today's behaviour until an admin sets it.
ALTER TABLE regions
    ADD COLUMN floor_warning_margin NUMERIC(10, 2),
    ADD CONSTRAINT ck_regions_floor_warning_margin
        CHECK (floor_warning_margin IS NULL OR floor_warning_margin > 0);
