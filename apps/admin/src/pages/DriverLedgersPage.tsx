import { UserLookup } from './money/UserLookup';

/** "Driver ledgers" section entry (UC-A-27): find a driver, open the ledger. */
export default function DriverLedgersPage() {
  return <UserLookup mode="ledger" />;
}
