-- M15-T1 analytics & CSV export (analytics-v1.yaml): the dashboard and the new admin lists select
-- by time range across every region, which the existing per-party / per-region indexes do not
-- serve. Indexes only — no schema change.

-- Ride metrics without a region filter (with one, idx_rides_region_requested serves).
CREATE INDEX idx_rides_requested ON rides (requested_at);

-- Acceptance rate: offers made in the range.
CREATE INDEX idx_ride_offers_offered ON ride_offers (offered_at);

-- Signups and the users list (newest first).
CREATE INDEX idx_users_created ON users (created_at DESC);

-- The transactions list (newest first) and its date filter.
CREATE INDEX idx_wallet_transactions_created ON wallet_transactions (created_at DESC);
CREATE INDEX idx_driver_ledger_created ON driver_ledger (created_at DESC);

-- Drivers online now: a small partial index over the online drivers only.
CREATE INDEX idx_driver_profiles_online ON driver_profiles (user_id) WHERE is_online;
