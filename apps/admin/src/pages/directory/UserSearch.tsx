import type { FormEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The name / phone search box of board V1FAdminUsersSearch, shared by the
 * Users page and the Driver ledgers lookup: a title, the box with its clear
 * icon, and a hint. Enter submits; the caller debounces typing.
 */
export function UserSearchBox({
  title,
  label,
  hint,
  value,
  inputRef,
  onChange,
  onSubmit,
  onClear,
}: {
  title: string;
  label: string;
  hint: string;
  value: string;
  inputRef: RefObject<HTMLInputElement>;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <form className="user-search" role="search" onSubmit={onSubmit}>
      <span className="user-search__title">{title}</span>
      <label className="user-search__field">
        <span className="visually-hidden">{label}</span>
        <span className="user-search__icon" aria-hidden="true">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.6" y2="16.6" />
          </svg>
        </span>
        <input
          ref={inputRef}
          className="user-search__input"
          dir="auto"
          value={value}
          placeholder={t('directory.users.search.placeholder')}
          onChange={(event) => onChange(event.target.value)}
        />
        {value !== '' ? (
          <button
            className="user-search__clear"
            type="button"
            aria-label={t('directory.users.search.clearLabel')}
            onClick={onClear}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        ) : null}
      </label>
      <span className="user-search__hint">{hint}</span>
    </form>
  );
}
