-- M14-T5 (owner ruling 2026-10-19 on the T5 walkthrough findings).
--
-- (a) submitted_as: the app a ticket was opened from (support-v1 CreateTicketRequest.submittedAs,
-- like FeedbackRequest.submittedAs), so admins see a driver-app ticket without a ride as the
-- driver's. Lost-item cases are always the rider's; SOS-linked tickets take the caller's side.
-- Existing rows: the side the user held on the linked ride, else rider.
ALTER TABLE support_tickets
    ADD COLUMN submitted_as VARCHAR(6);

UPDATE support_tickets t
SET submitted_as = CASE
        WHEN r.driver_user_id IS NOT NULL AND r.driver_user_id = t.user_id THEN 'driver'
        ELSE 'rider'
    END
FROM support_tickets s
         LEFT JOIN rides r ON r.ride_id = s.ride_id
WHERE s.support_ticket_id = t.support_ticket_id;

ALTER TABLE support_tickets
    ALTER COLUMN submitted_as SET NOT NULL,
    ADD CONSTRAINT ck_support_tickets_submitted_as CHECK (submitted_as IN ('rider', 'driver')),
    ADD CONSTRAINT ck_support_tickets_lost_item_rider
        CHECK (kind <> 'lost_item' OR submitted_as = 'rider');

-- (b) seq: the insertion order of history rows. Rows written by one request share one clock
-- instant (a case change and its mirrored status change), so the thread orders by
-- (created_at, seq) instead of the random event id.
ALTER TABLE ticket_events
    ADD COLUMN seq BIGINT GENERATED ALWAYS AS IDENTITY;
