import { UserLookup } from './money/UserLookup';

/** "Users" section entry (UC-A-13/15): find a user, open their wallet. */
export default function UsersPage() {
  return <UserLookup mode="wallet" />;
}
