-- M12 review fixes (docs/reviews/review-M12.md H2, H3; owner rulings 2026-10-17).
-- H3: on a shared ride the creator is a member like any other — whether a rider is ON that ride is
-- decided by their membership (shared_ride_members.status = 'joined'), never by
-- rides.rider_user_id. The one-active-ride-per-rider backstop therefore covers the rider's OWN
-- rides only; for shared rides the services hold one open membership per rider under a per-rider
-- transaction lock (H2/W12), and a gathering membership counts as busy.
DROP INDEX uq_rides_rider_active;
CREATE UNIQUE INDEX uq_rides_rider_active ON rides (rider_user_id)
    WHERE state IN ('requested', 'offering', 'accepted', 'driver_arrived', 'in_progress')
        AND kind <> 'shared';
