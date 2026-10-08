-- M7-T2: runtime columns of the ride loop (rides-v1.yaml). Kept on the ride row, not in instance
-- memory (NFR-P4): any backend instance can run the monitor job and serve any request.
ALTER TABLE rides
    -- When the assigned driver's stream went stale (> 30 s, TRK-04); NULL = healthy. The monitor
    -- job flips it once per edge so `ride.connection` fires once when lost and once when back.
    ADD COLUMN driver_stream_lost_at TIMESTAMPTZ,
    -- The last RoutingProvider ETA (to pickup before start, to destination after) and when it
    -- was computed; refreshed at most every RIDE_ETA_REFRESH_SECONDS (TRK-02).
    ADD COLUMN eta_seconds           INTEGER,
    ADD COLUMN eta_refreshed_at      TIMESTAMPTZ,
    -- The driver's note when marking a completed ride unpaid (UC-D-09 E1, support path later).
    ADD COLUMN payment_note          VARCHAR(500),
    ADD CONSTRAINT ck_rides_eta CHECK (eta_seconds IS NULL OR eta_seconds >= 0);
