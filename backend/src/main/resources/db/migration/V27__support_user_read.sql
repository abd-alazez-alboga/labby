-- M14-T2 (owner ruling 2026-10-19 at the T2 plan gate): the user's read marker on their own
-- ticket thread, stamped by GET /tickets/{ticketId}. `unreadSupportMessages` (support-v1 Ticket)
-- counts support messages created after it; null = never opened, every support message unread.
ALTER TABLE support_tickets
    ADD COLUMN user_read_at TIMESTAMPTZ;
