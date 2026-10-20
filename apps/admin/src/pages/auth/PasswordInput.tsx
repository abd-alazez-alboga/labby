import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A password input with its show/hide eye toggle (owner UX standard: every
 * password field can be revealed). Shared by sign-in and the set/reset
 * password flow (V1 audit H2).
 */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  disabled = false,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete: 'current-password' | 'new-password';
  disabled?: boolean;
  describedBy?: string;
}) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="form-field__password">
      <input
        id={id}
        type={revealed ? 'text' : 'password'}
        dir={revealed ? 'ltr' : undefined}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        disabled={disabled}
        aria-describedby={describedBy}
      />
      <button
        type="button"
        className="form-field__reveal"
        aria-label={t(revealed ? 'auth.hidePassword' : 'auth.showPassword')}
        aria-pressed={revealed}
        onClick={() => setRevealed((v) => !v)}
      >
        {revealed ? (
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M3 3l18 18M10.6 10.7a2.5 2.5 0 0 0 3.5 3.5M6.6 6.7C4.1 8.3 2.5 10.6 2 12c1.3 3.3 5.3 7 10 7 1.8 0 3.5-.5 5-1.4M9.9 4.3A10 10 0 0 1 12 5c4.7 0 8.7 3.7 10 7-.4 1-1.3 2.4-2.6 3.7" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M2 12c1.3-3.3 5.3-7 10-7s8.7 3.7 10 7c-1.3 3.3-5.3 7-10 7S3.3 15.3 2 12Z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        )}
      </button>
    </div>
  );
}
