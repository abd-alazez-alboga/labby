-- M14-T6 review fixes (owner rulings 2026-10-19, review-M14 H1 / H3).
--
-- (a) version: optimistic locking on support tickets. Admin moves, user replies and the case
-- machine all load-then-save the same row; without a version a stale save wrote an old status
-- back (a closed case — and so its ride chat — could reopen). Conflicts answer 409.
ALTER TABLE support_tickets
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

-- (b) case_outcome: the last of found / not_found / returned a lost-item case reached
-- (support-v1 LostItemCase.outcome, T6 amendment i), so a closed case still shows its result.
ALTER TABLE support_tickets
    ADD COLUMN case_outcome VARCHAR(16),
    ADD CONSTRAINT ck_support_tickets_case_outcome CHECK (
        case_outcome IS NULL
        OR (kind = 'lost_item' AND case_outcome IN ('found', 'not_found', 'returned')));

UPDATE support_tickets t
SET case_outcome = (
    SELECT e.to_value
    FROM ticket_events e
    WHERE e.support_ticket_id = t.support_ticket_id
      AND e.type = 'case_status_changed'
      AND e.to_value IN ('found', 'not_found', 'returned')
    ORDER BY e.created_at DESC, e.seq DESC
    LIMIT 1)
WHERE t.kind = 'lost_item';
