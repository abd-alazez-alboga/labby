-- Review V1 H3 (owner ruling 2026-10-20): phones are stored as E.164 `+<country><number>` with
-- Syria as the default country, so one handset is one identity (USR-01, AUTH-01). The rules are
-- exactly util/PhoneNumbers.normalize, which every phone input now goes through: spaces and
-- dashes stripped; `+…` kept; `00…` -> `+…`; `0…` -> `+963…` (leading zero dropped);
-- `963…` -> `+963…`; anything else is left as it is (no rule applies).
--
-- Two accounts that collapse onto one number cannot be merged automatically (which one keeps the
-- phone is a human decision), so the migration FAILS FAST naming them; there are no production
-- users yet (owner). Same for the once-per-phone referral record (GRW-03).

CREATE FUNCTION labby_v35_normalize_phone(raw TEXT) RETURNS TEXT
    LANGUAGE sql IMMUTABLE AS
$$
SELECT CASE
           WHEN p LIKE '+%' THEN p
           WHEN p LIKE '00%' THEN '+' || substr(p, 3)
           WHEN p LIKE '0%' THEN '+963' || substr(p, 2)
           WHEN p LIKE '963%' THEN '+' || p
           ELSE p
       END
FROM (SELECT regexp_replace(raw, '[[:space:]-]', '', 'g') AS p) AS stripped
$$;

DO
$$
DECLARE
    clash TEXT;
BEGIN
    SELECT string_agg(normalized || ' <- ' || phones, '; ')
    INTO clash
    FROM (SELECT labby_v35_normalize_phone(phone) AS normalized,
                 string_agg(phone || ' (' || user_id || ')', ', ' ORDER BY phone) AS phones
          FROM users
          GROUP BY labby_v35_normalize_phone(phone)
          HAVING count(*) > 1) AS clashes;
    IF clash IS NOT NULL THEN
        RAISE EXCEPTION 'V35: several accounts share one phone after E.164 normalization; resolve them by hand first: %', clash;
    END IF;

    SELECT string_agg(normalized || ' <- ' || phones, '; ')
    INTO clash
    FROM (SELECT labby_v35_normalize_phone(referee_phone) AS normalized,
                 string_agg(referee_phone, ', ' ORDER BY referee_phone) AS phones
          FROM referrals
          GROUP BY labby_v35_normalize_phone(referee_phone)
          HAVING count(*) > 1) AS clashes;
    IF clash IS NOT NULL THEN
        RAISE EXCEPTION 'V35: several referrals share one referee phone after E.164 normalization; resolve them by hand first: %', clash;
    END IF;
END
$$;

-- No collision is left, and normalization is idempotent (a target value that already exists is
-- itself normalized and unchanged), so the unique constraints hold row by row.
UPDATE users
SET phone = labby_v35_normalize_phone(phone)
WHERE phone <> labby_v35_normalize_phone(phone);

UPDATE referrals
SET referee_phone = labby_v35_normalize_phone(referee_phone)
WHERE referee_phone <> labby_v35_normalize_phone(referee_phone);

-- Short-lived auth state follows, so a code sent or a change started before the upgrade still
-- resolves under the canonical number.
UPDATE otp_codes
SET phone = labby_v35_normalize_phone(phone)
WHERE phone <> labby_v35_normalize_phone(phone);

UPDATE phone_change_sessions
SET new_phone = labby_v35_normalize_phone(new_phone)
WHERE new_phone <> labby_v35_normalize_phone(new_phone);

-- Failed-login windows (NFR-S3, at most 15 minutes old): a variant whose canonical key already has
-- a window for the same client is dropped (the canonical window keeps throttling); the rest move.
DELETE
FROM login_failures f
WHERE f.phone <> labby_v35_normalize_phone(f.phone)
  AND EXISTS (SELECT 1
              FROM login_failures other
              WHERE other.client_ip = f.client_ip
                AND other.login_failure_id <> f.login_failure_id
                AND labby_v35_normalize_phone(other.phone) = labby_v35_normalize_phone(f.phone)
                AND (other.phone = labby_v35_normalize_phone(other.phone)
                    OR other.login_failure_id < f.login_failure_id));

UPDATE login_failures
SET phone = labby_v35_normalize_phone(phone)
WHERE phone <> labby_v35_normalize_phone(phone);

DROP FUNCTION labby_v35_normalize_phone(TEXT);
