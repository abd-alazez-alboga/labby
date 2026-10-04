-- M2-T6: Terms-of-Service consent evidence (UC-S-01 step 4, ASM-05).
-- Nullable: pre-existing/seeded rows get it backfilled by their flows; every
-- new registration sets it at completion time.
ALTER TABLE users ADD COLUMN terms_accepted_at TIMESTAMPTZ;
