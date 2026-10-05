-- M4: regions & pricing config (ADM-01, PRC-01/02/03 config side, SD-01; UC-A-05..09).
-- Geometry decision: PostGIS. Boundaries and surge zones are geometry(Polygon, 4326)
-- (GeoJSON lng/lat order at the API edge); point-in-polygon runs in SQL with GiST
-- indexes so region resolution (SD-01) and the M9 surge cycle stay indexed queries.
-- A region is a DRAFT until its mandatory bundle is complete (UC-A-05 E1) — most
-- columns are therefore nullable; activation completeness is a service rule (M4-T2).

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE regions (
    region_id               UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    name                    VARCHAR(100)         NOT NULL,
    boundary                geometry(Polygon, 4326),
    currency                VARCHAR(3),
    emergency_number        VARCHAR(20),
    state                   VARCHAR(10)          NOT NULL DEFAULT 'draft',
    -- Settings bundle scalars (ADM-01; SRS defaults in §"Defaults"). All per region.
    cancellation_grace_min  INTEGER,
    cancellation_fee        NUMERIC(10, 2),
    wait_grace_min          INTEGER,
    wait_per_min_rate       NUMERIC(10, 2),
    pickup_fee_threshold_km NUMERIC(6, 1),
    pickup_fee_per_km       NUMERIC(10, 2),
    surge_cap               NUMERIC(4, 2),
    -- Structured bundle parts; shapes are defined by the regions-v1.yaml contract.
    commission_tiers        JSONB,
    incentive_values        JSONB,
    suspension_thresholds   JSONB,
    created_at              TIMESTAMPTZ          NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ          NOT NULL DEFAULT now(),
    created_by              UUID,
    updated_by              UUID,
    CONSTRAINT uq_regions_name UNIQUE (name),
    CONSTRAINT ck_regions_state CHECK (state IN ('draft', 'active'))
);

CREATE INDEX idx_regions_boundary ON regions USING gist (boundary);
CREATE INDEX idx_regions_state ON regions (state);

CREATE TABLE service_types (
    service_type_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    region_id       UUID                 NOT NULL REFERENCES regions (region_id),
    name_en         VARCHAR(50)          NOT NULL,
    name_ar         VARCHAR(50)          NOT NULL,
    base_fare       NUMERIC(10, 2)       NOT NULL,
    per_km_rate     NUMERIC(10, 2)       NOT NULL,
    per_min_rate    NUMERIC(10, 2)       NOT NULL,
    minimum_fare    NUMERIC(10, 2)       NOT NULL,
    enabled         BOOLEAN              NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ          NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ          NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    CONSTRAINT uq_service_types_region_name UNIQUE (region_id, name_en)
);

CREATE INDEX idx_service_types_region ON service_types (region_id);

CREATE TABLE surcharge_windows (
    surcharge_window_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    region_id           UUID                 NOT NULL REFERENCES regions (region_id),
    label               VARCHAR(50)          NOT NULL,
    starts_at           TIME                 NOT NULL,
    ends_at             TIME                 NOT NULL,
    days_of_week        JSONB                NOT NULL,
    percent             NUMERIC(5, 2)        NOT NULL,
    created_at          TIMESTAMPTZ          NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ          NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_by          UUID
);

CREATE INDEX idx_surcharge_windows_region ON surcharge_windows (region_id);

-- Surge zones belong to exactly one region (M4-T2 validates containment rules).
-- threshold_steps: ordered [{"ratio": 2, "multiplier": 1.2}, ...] (PRC-02 defaults).
-- Override fields ship now so the M9 manual-override flow (UC-A-09) is a pure
-- service/UI addition; until M9 they stay null.
CREATE TABLE surge_zones (
    surge_zone_id       UUID PRIMARY KEY         DEFAULT gen_random_uuid(),
    region_id           UUID                     NOT NULL REFERENCES regions (region_id),
    name                VARCHAR(100)             NOT NULL,
    polygon             geometry(Polygon, 4326)  NOT NULL,
    threshold_steps     JSONB                    NOT NULL,
    multiplier_cap      NUMERIC(4, 2),
    override_multiplier NUMERIC(4, 2),
    override_set_by     UUID REFERENCES users (user_id),
    override_set_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_by          UUID,
    CONSTRAINT uq_surge_zones_region_name UNIQUE (region_id, name)
);

CREATE INDEX idx_surge_zones_region ON surge_zones (region_id);
CREATE INDEX idx_surge_zones_polygon ON surge_zones USING gist (polygon);
