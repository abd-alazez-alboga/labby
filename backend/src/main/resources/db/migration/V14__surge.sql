-- M9 surge cycle (PRC-02, DRV-09, UC-A-09). Contract: docs/api/regions-v1.yaml, surge-v1.yaml,
-- rides-v1.yaml.

-- Per-zone multiplier state, written ONLY by the surge cycle (SurgeService.recompute); the zone
-- upsert never touches these columns, nor the override columns (UC-A-09 has its own endpoints).
-- computed_multiplier: the threshold step reached by demand/supply, capped (zone cap / region
-- cap). current_multiplier: what pricing reads — the override when one is set, else the computed
-- value — so an override (or its reset) takes effect at the NEXT cycle. demand_count /
-- supply_count: the inputs of the last cycle (open requests / idle online drivers in the zone).
-- computed_at: NULL until the zone's first cycle.
ALTER TABLE surge_zones
    ADD COLUMN current_multiplier  NUMERIC(4, 2) NOT NULL DEFAULT 1.00,
    ADD COLUMN computed_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.00,
    ADD COLUMN demand_count        INTEGER       NOT NULL DEFAULT 0,
    ADD COLUMN supply_count        INTEGER       NOT NULL DEFAULT 0,
    ADD COLUMN computed_at         TIMESTAMPTZ,
    ADD CONSTRAINT ck_surge_zones_current_multiplier CHECK (current_multiplier >= 1),
    ADD CONSTRAINT ck_surge_zones_computed_multiplier CHECK (computed_multiplier >= 1),
    ADD CONSTRAINT ck_surge_zones_override_multiplier
        CHECK (override_multiplier IS NULL OR override_multiplier >= 1),
    ADD CONSTRAINT ck_surge_zones_counts CHECK (demand_count >= 0 AND supply_count >= 0);

-- The cycle's demand count: open requests whose pickup the zone polygon covers. Partial on the
-- open states, so the index stays as small as the live request queue.
CREATE INDEX idx_rides_pickup_open ON rides USING gist (pickup)
    WHERE state IN ('requested', 'offering');
