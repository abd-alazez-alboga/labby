-- M7: on-demand ride loop (RIDE-01..08, TRK-02/03, PRC-01 core, PRC-04, RIDE-07 grace logic;
-- UC-R-01..07/09, UC-D-06..10, UC-A-18). Contract: docs/api/rides-v1.yaml.
-- Owner decisions (2026-10-07): a driver cancellation after acceptance ENDS the ride
-- (cancelled_by_driver, terminal per RIDE-02) and a new linked ride is dispatched
-- (redispatch_of_ride_id); the matching toggle is ONE exclusive setting (nearby_only default |
-- accept_distant_fee); surcharge windows are evaluated in the region's time zone, overnight
-- windows span midnight, overlapping windows -> highest percent wins.
-- Money is cash only in M7; a cancellation fee is computed and recorded here and collected by
-- the M8 money rails. Wait/pickup-distance charges and surge values stay 0 / 1.0 until M8 / M9.

-- Surcharge windows are "region-local" (regions-v1.yaml): the region now says which zone that is.
ALTER TABLE regions
    ADD COLUMN time_zone VARCHAR(64) NOT NULL DEFAULT 'Asia/Damascus';

-- One row per ride. State machine (RIDE-02):
--   requested -> offering -> accepted -> driver_arrived -> in_progress -> completed
--   exits: cancelled_by_rider (requested..driver_arrived), cancelled_by_driver
--   (accepted/driver_arrived), no_driver_found (requested/offering).
-- Every transition has its own timestamp. version = optimistic lock for the dispatch races
-- (cancel mid-offer vs accept).
CREATE TABLE rides (
    ride_id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_user_id             UUID                   NOT NULL REFERENCES users (user_id),
    driver_user_id            UUID REFERENCES users (user_id),
    vehicle_id                UUID REFERENCES vehicles (vehicle_id),
    region_id                 UUID                   NOT NULL REFERENCES regions (region_id),
    service_type_id           UUID                   NOT NULL REFERENCES service_types (service_type_id),
    kind                      VARCHAR(12)            NOT NULL DEFAULT 'on_demand',
    state                     VARCHAR(20)            NOT NULL DEFAULT 'requested',
    pickup                    geometry(Point, 4326)  NOT NULL,
    pickup_label              VARCHAR(200),
    destination               geometry(Point, 4326)  NOT NULL,
    destination_label         VARCHAR(200),
    -- Intermediate stops in order: [{"lat", "lng", "label"?}], at most 3 (RIDE-01/05).
    stops                     JSONB                  NOT NULL DEFAULT '[]',
    payment_method            VARCHAR(8)             NOT NULL,
    -- The rider's matching toggle as it was at booking (dispatch + pickup fee read this).
    pickup_distance_mode      VARCHAR(20)            NOT NULL,
    -- Pricing locked at request (PRC-02 surge; owner 2026-10-07: surcharge % too).
    currency                  VARCHAR(3)             NOT NULL,
    surge_multiplier          NUMERIC(4, 2)          NOT NULL DEFAULT 1.00,
    surcharge_percent         NUMERIC(5, 2)          NOT NULL DEFAULT 0,
    -- The estimate the rider confirmed (RIDE-01); updated on in-ride route changes (RIDE-05).
    estimate_total            NUMERIC(10, 2)         NOT NULL,
    estimate_distance_m       INTEGER                NOT NULL,
    estimate_duration_s       INTEGER                NOT NULL,
    estimate_approximate      BOOLEAN                NOT NULL DEFAULT false,
    estimate_components       JSONB                  NOT NULL,
    -- RIDE-08 one-tap retry and the owner's driver-cancel re-dispatch both create a NEW ride.
    retry_of_ride_id          UUID REFERENCES rides (ride_id),
    redispatch_of_ride_id     UUID REFERENCES rides (ride_id),
    requested_at              TIMESTAMPTZ            NOT NULL DEFAULT now(),
    offering_at               TIMESTAMPTZ,
    accepted_at               TIMESTAMPTZ,
    driver_arrived_at         TIMESTAMPTZ,
    started_at                TIMESTAMPTZ,
    completed_at              TIMESTAMPTZ,
    cancelled_at              TIMESTAMPTZ,
    no_driver_found_at        TIMESTAMPTZ,
    -- RIDE-07: free until this moment (accepted_at + the region's grace, fixed at acceptance).
    cancellation_grace_ends_at TIMESTAMPTZ,
    cancellation_reason       VARCHAR(24),
    cancellation_note         VARCHAR(500),
    -- Recorded now, collected by M8. NULL = free cancellation.
    cancellation_fee          NUMERIC(10, 2),
    -- Payment after completion (PAY-02, UC-D-09 E1); NULL until completed.
    payment_status            VARCHAR(12),
    payment_confirmed_at      TIMESTAMPTZ,
    version                   BIGINT                 NOT NULL DEFAULT 0,
    created_at                TIMESTAMPTZ            NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ            NOT NULL DEFAULT now(),
    CONSTRAINT ck_rides_kind CHECK (kind IN ('on_demand', 'scheduled', 'shared')),
    CONSTRAINT ck_rides_state CHECK (state IN ('requested', 'offering', 'accepted',
        'driver_arrived', 'in_progress', 'completed', 'cancelled_by_rider',
        'cancelled_by_driver', 'no_driver_found')),
    CONSTRAINT ck_rides_stops
        CHECK (jsonb_typeof(stops) = 'array' AND jsonb_array_length(stops) <= 3),
    CONSTRAINT ck_rides_payment_method CHECK (payment_method IN ('cash', 'wallet')),
    CONSTRAINT ck_rides_pickup_distance_mode
        CHECK (pickup_distance_mode IN ('nearby_only', 'accept_distant_fee')),
    CONSTRAINT ck_rides_surge CHECK (surge_multiplier >= 1),
    CONSTRAINT ck_rides_surcharge CHECK (surcharge_percent >= 0),
    CONSTRAINT ck_rides_estimate CHECK (estimate_total >= 0 AND estimate_distance_m >= 0
        AND estimate_duration_s >= 0),
    CONSTRAINT ck_rides_single_origin
        CHECK (retry_of_ride_id IS NULL OR redispatch_of_ride_id IS NULL),
    -- A driver + vehicle are bound from acceptance on, never before.
    CONSTRAINT ck_rides_driver_bound CHECK (
        (state IN ('requested', 'offering', 'no_driver_found')
            AND driver_user_id IS NULL AND vehicle_id IS NULL)
        OR (state IN ('accepted', 'driver_arrived', 'in_progress', 'completed',
                      'cancelled_by_driver')
            AND driver_user_id IS NOT NULL AND vehicle_id IS NOT NULL)
        OR (state = 'cancelled_by_rider'
            AND (driver_user_id IS NULL) = (vehicle_id IS NULL))),
    -- The timestamp of the current state is always set.
    CONSTRAINT ck_rides_state_timestamp CHECK (
        (state <> 'offering' OR offering_at IS NOT NULL)
        AND (state <> 'accepted' OR accepted_at IS NOT NULL)
        AND (state <> 'driver_arrived' OR driver_arrived_at IS NOT NULL)
        AND (state <> 'in_progress' OR started_at IS NOT NULL)
        AND (state <> 'completed' OR completed_at IS NOT NULL)
        AND (state <> 'no_driver_found' OR no_driver_found_at IS NOT NULL)),
    -- Cancellations carry their moment and a reason (driver reasons are mandatory, RIDE-07).
    CONSTRAINT ck_rides_cancellation CHECK (
        (state IN ('cancelled_by_rider', 'cancelled_by_driver'))
            = (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)),
    CONSTRAINT ck_rides_cancellation_reason CHECK (cancellation_reason IS NULL
        OR cancellation_reason IN ('changed_mind', 'driver_too_far', 'wrong_pickup',
            'rider_no_show', 'vehicle_issue', 'unsafe_pickup', 'other')),
    -- Driver cancellations never charge the rider (RIDE-07).
    CONSTRAINT ck_rides_cancellation_fee CHECK (
        cancellation_fee IS NULL
        OR (state = 'cancelled_by_rider' AND cancellation_fee > 0)
        OR (state = 'cancelled_by_driver' AND cancellation_reason = 'rider_no_show'
            AND cancellation_fee > 0)),
    CONSTRAINT ck_rides_payment_status CHECK (
        (payment_status IS NULL AND state <> 'completed')
        OR (state = 'completed' AND payment_status IN ('pending', 'paid_cash', 'unpaid'))),
    CONSTRAINT ck_rides_payment_confirmed
        CHECK ((payment_confirmed_at IS NOT NULL) = (payment_status IN ('paid_cash', 'unpaid')))
);

-- One active ride per rider (UC-R-04 E4), enforced by the database against double booking.
CREATE UNIQUE INDEX uq_rides_rider_active ON rides (rider_user_id)
    WHERE state IN ('requested', 'offering', 'accepted', 'driver_arrived', 'in_progress');
CREATE INDEX idx_rides_rider_requested ON rides (rider_user_id, requested_at DESC);
CREATE INDEX idx_rides_driver_requested ON rides (driver_user_id, requested_at DESC)
    WHERE driver_user_id IS NOT NULL;
CREATE INDEX idx_rides_region_requested ON rides (region_id, requested_at DESC);
CREATE INDEX idx_rides_state_active ON rides (state)
    WHERE state IN ('requested', 'offering', 'accepted', 'driver_arrived', 'in_progress');

-- The dispatch trail (RIDE-03, UC-A-18): one row per offer, in candidate order. response NULL =
-- pending. 'withdrawn' = the ride ended while the offer was open (rider cancelled, another path
-- finished it) — it does not count against the driver's acceptance metric; 'timeout' does.
CREATE TABLE ride_offers (
    ride_offer_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id           UUID        NOT NULL REFERENCES rides (ride_id),
    driver_user_id    UUID        NOT NULL REFERENCES users (user_id),
    vehicle_id        UUID        NOT NULL REFERENCES vehicles (vehicle_id),
    sequence          SMALLINT    NOT NULL,
    pickup_distance_m INTEGER     NOT NULL,
    pickup_eta_s      INTEGER     NOT NULL,
    offered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ NOT NULL,
    response          VARCHAR(10),
    responded_at      TIMESTAMPTZ,
    CONSTRAINT uq_ride_offers_sequence UNIQUE (ride_id, sequence),
    -- A driver is offered a given ride at most once.
    CONSTRAINT uq_ride_offers_driver UNIQUE (ride_id, driver_user_id),
    CONSTRAINT ck_ride_offers_response
        CHECK (response IS NULL OR response IN ('accepted', 'declined', 'timeout', 'withdrawn')),
    CONSTRAINT ck_ride_offers_responded CHECK ((response IS NULL) = (responded_at IS NULL)),
    CONSTRAINT ck_ride_offers_window CHECK (expires_at > offered_at),
    CONSTRAINT ck_ride_offers_pickup CHECK (pickup_distance_m >= 0 AND pickup_eta_s >= 0)
);

-- Sequential dispatch as a database guarantee: at most one open offer per ride, and a driver
-- holds at most one open offer at a time.
CREATE UNIQUE INDEX uq_ride_offers_pending_ride ON ride_offers (ride_id) WHERE response IS NULL;
CREATE UNIQUE INDEX uq_ride_offers_pending_driver ON ride_offers (driver_user_id)
    WHERE response IS NULL;
CREATE INDEX idx_ride_offers_driver_offered ON ride_offers (driver_user_id, offered_at DESC);
CREATE INDEX idx_ride_offers_pending_expiry ON ride_offers (expires_at) WHERE response IS NULL;

-- Full GPS trace per ride (TRK-03, retention forever): the source of truth for the metered fare
-- (phase in_ride), receipt route maps and dispute review. to_pickup samples cover
-- acceptance -> start (pickup-distance fee, M8). Identity key: traces are high-volume.
CREATE TABLE ride_traces (
    ride_trace_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ride_id       UUID                  NOT NULL REFERENCES rides (ride_id),
    phase         VARCHAR(10)           NOT NULL,
    position      geometry(Point, 4326) NOT NULL,
    accuracy_m    REAL,
    speed_mps     REAL,
    heading_deg   REAL,
    recorded_at   TIMESTAMPTZ           NOT NULL,
    received_at   TIMESTAMPTZ           NOT NULL DEFAULT now(),
    CONSTRAINT ck_ride_traces_phase CHECK (phase IN ('to_pickup', 'in_ride')),
    CONSTRAINT ck_ride_traces_accuracy CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
    CONSTRAINT ck_ride_traces_speed CHECK (speed_mps IS NULL OR speed_mps >= 0),
    CONSTRAINT ck_ride_traces_heading
        CHECK (heading_deg IS NULL OR (heading_deg >= 0 AND heading_deg < 360))
);

CREATE INDEX idx_ride_traces_ride_recorded ON ride_traces (ride_id, recorded_at);

-- The final fare of a completed ride (RIDE-06, PRC-04): every component is stored and receipts /
-- history render from this row, never recomputed. Written once at completion. total =
-- base + distance + time + surcharge + surge + wait + pickup fee + minimum-fare top-up
-- - discount (tips are outside the fare total; PAY-04 lands in M8).
CREATE TABLE fares (
    ride_id                 UUID PRIMARY KEY REFERENCES rides (ride_id),
    currency                VARCHAR(3)     NOT NULL,
    distance_m              INTEGER        NOT NULL,
    duration_s              INTEGER        NOT NULL,
    base_fare               NUMERIC(10, 2) NOT NULL,
    distance_fare           NUMERIC(10, 2) NOT NULL,
    time_fare               NUMERIC(10, 2) NOT NULL,
    surcharge_percent       NUMERIC(5, 2)  NOT NULL DEFAULT 0,
    surcharge_amount        NUMERIC(10, 2) NOT NULL DEFAULT 0,
    surge_multiplier        NUMERIC(4, 2)  NOT NULL DEFAULT 1.00,
    surge_amount            NUMERIC(10, 2) NOT NULL DEFAULT 0,
    wait_fare               NUMERIC(10, 2) NOT NULL DEFAULT 0,
    pickup_fee              NUMERIC(10, 2) NOT NULL DEFAULT 0,
    minimum_fare_adjustment NUMERIC(10, 2) NOT NULL DEFAULT 0,
    discount                NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total                   NUMERIC(10, 2) NOT NULL,
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT ck_fares_measured CHECK (distance_m >= 0 AND duration_s >= 0),
    CONSTRAINT ck_fares_components CHECK (base_fare >= 0 AND distance_fare >= 0
        AND time_fare >= 0 AND surcharge_amount >= 0 AND surge_amount >= 0 AND wait_fare >= 0
        AND pickup_fee >= 0 AND minimum_fare_adjustment >= 0 AND discount >= 0),
    CONSTRAINT ck_fares_surge CHECK (surge_multiplier >= 1),
    CONSTRAINT ck_fares_total CHECK (total >= 0 AND total = base_fare + distance_fare + time_fare
        + surcharge_amount + surge_amount + wait_fare + pickup_fee + minimum_fare_adjustment
        - discount)
);

-- Rider saved places (UC-R-01). Names are unique per rider, case-insensitively (E1).
CREATE TABLE saved_locations (
    saved_location_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_user_id     UUID                  NOT NULL REFERENCES users (user_id),
    name              VARCHAR(50)           NOT NULL,
    position          geometry(Point, 4326) NOT NULL,
    address           VARCHAR(200),
    created_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),
    CONSTRAINT ck_saved_locations_name CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX uq_saved_locations_rider_name ON saved_locations (rider_user_id, lower(name));

-- Rider extras (USR-03): comfort preferences (UC-R-02, shown to the driver on every trip) and the
-- matching toggle (UC-R-03). No row = all defaults.
CREATE TABLE rider_preferences (
    user_id              UUID PRIMARY KEY REFERENCES users (user_id),
    temperature          VARCHAR(16) NOT NULL DEFAULT 'no_preference',
    conversation         VARCHAR(16) NOT NULL DEFAULT 'no_preference',
    music                VARCHAR(16) NOT NULL DEFAULT 'no_preference',
    pickup_distance_mode VARCHAR(20) NOT NULL DEFAULT 'nearby_only',
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_rider_preferences_temperature
        CHECK (temperature IN ('no_preference', 'cool', 'normal', 'warm')),
    CONSTRAINT ck_rider_preferences_conversation
        CHECK (conversation IN ('no_preference', 'quiet', 'chatty')),
    CONSTRAINT ck_rider_preferences_music
        CHECK (music IN ('no_preference', 'none', 'soft', 'any')),
    CONSTRAINT ck_rider_preferences_pickup_distance_mode
        CHECK (pickup_distance_mode IN ('nearby_only', 'accept_distant_fee'))
);
