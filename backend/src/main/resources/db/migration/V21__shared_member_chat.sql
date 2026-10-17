-- M12-T2 C2: shared rides in the comms and trust contracts (scheduled-shared-v1.yaml, "Shared
-- rides in the other contracts"; owner ruling 2026-10-16).
-- CHAT-01..03 per member: one PRIVATE thread per ride x rider — on a shared ride one per member
-- with the driver (never between members), on any other ride the single thread it always had.
-- Existing threads belong to their ride's rider (a Phase B shared ride's thread = its creator's).
ALTER TABLE chat_threads
    ADD COLUMN rider_user_id UUID REFERENCES users (user_id);
UPDATE chat_threads t
SET rider_user_id = r.rider_user_id
FROM rides r
WHERE r.ride_id = t.ride_id;
ALTER TABLE chat_threads
    ALTER COLUMN rider_user_id SET NOT NULL;
ALTER TABLE chat_threads
    DROP CONSTRAINT chat_threads_ride_id_key;
ALTER TABLE chat_threads
    ADD CONSTRAINT uq_chat_threads_ride_rider UNIQUE (ride_id, rider_user_id);

-- REP-01 per member (owner approval 2026-10-17): the driver of a shared ride may report each
-- member — one report per ride x reporter -> reported pair (on a one-rider ride: one per side,
-- as before).
ALTER TABLE reports
    DROP CONSTRAINT uq_reports_ride_reporter;
ALTER TABLE reports
    ADD CONSTRAINT uq_reports_ride_reporter_reported
        UNIQUE (ride_id, reporter_user_id, reported_user_id);
