import type { ReactNode } from 'react';

/** How long a search box waits after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The name with the searched text marked (board V1FAdminUsersSearch), case-insensitive. */
export function highlightName(name: string, query: string): ReactNode {
  const needle = query.trim().toLocaleLowerCase();
  const at = needle === '' ? -1 : name.toLocaleLowerCase().indexOf(needle);
  if (at < 0) {
    return name;
  }
  return (
    <>
      {name.slice(0, at)}
      <mark className="search-hit">{name.slice(at, at + needle.length)}</mark>
      {name.slice(at + needle.length)}
    </>
  );
}
