-- M6 review W4 (NFR-P4): the outbox dispatcher must be safe with more than one backend instance.
-- A dispatcher CLAIMS an entry (claimed_at = now) in the same transaction that writes its
-- notification-center row, before any push, so another instance skips it while the push is in
-- flight. A claim older than the dispatcher's claim timeout is stale (the instance died
-- mid-push) and the entry becomes claimable again; delivered_at still marks the end of delivery.
ALTER TABLE notification_outbox
    ADD COLUMN claimed_at TIMESTAMPTZ;
