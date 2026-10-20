-- V1 audit H4 (UC-A-06, M4-T2 AC; regions-v1 "in-flight rides are never mutated"): every pricing
-- input of a ride is locked on it when it is requested (or when a scheduled / shared ride goes
-- live, where surge is locked too), next to the estimate components. Completion, the PRC-03 extras
-- (wait charge, pickup-distance fee) and the cancellation fee / grace are priced from this
-- snapshot, so an admin edit of the service type or region applies to new rides only.
--
-- Shape: {"baseFare", "perKmRate", "perMinRate", "minimumFare", "waitGraceMin", "waitPerMinRate",
-- "pickupFeeThresholdKm", "pickupFeePerKm", "cancellationGraceMin", "cancellationFee"} — the
-- region values with the SRS defaults already applied; "cancellationFee" null = no fee.
-- NULL on rides created before this migration: those keep reading the live config.
ALTER TABLE rides
    ADD COLUMN pricing_snapshot JSONB;
