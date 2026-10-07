-- Owner decision 2026-10-07: deleting an account withdraws its open driver application
-- (submitted / under_review / needs_changes -> withdrawn). It leaves the review queue, can no
-- longer be decided, and the reactivated account reapplies (withdrawn -> submitted).
ALTER TABLE driver_profiles DROP CONSTRAINT ck_driver_profiles_status;
ALTER TABLE driver_profiles ADD CONSTRAINT ck_driver_profiles_status CHECK (application_status IN
    ('submitted', 'under_review', 'needs_changes', 'approved', 'rejected', 'withdrawn'));

ALTER TABLE driver_application_events DROP CONSTRAINT ck_driver_application_events_to;
ALTER TABLE driver_application_events ADD CONSTRAINT ck_driver_application_events_to
    CHECK (to_status IN
        ('submitted', 'under_review', 'needs_changes', 'approved', 'rejected', 'withdrawn'));
