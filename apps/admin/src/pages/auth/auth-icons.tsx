import type { ReactNode } from 'react';

/** The small stroke icons of the sign-in and set/reset password cards (V1FAdminSetPassword). */

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function LockIcon() {
  return (
    <Icon>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  );
}

/** A "back" chevron; mirrored in RTL by CSS (`.icon--flip-rtl`). */
export function BackIcon() {
  return (
    <Icon className="icon--flip-rtl">
      <polyline points="15 18 9 12 15 6" />
    </Icon>
  );
}

export function AlertIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16" x2="12" y2="16" />
    </Icon>
  );
}

export function CheckIcon() {
  return (
    <Icon>
      <polyline points="20 6 9 17 4 12" />
    </Icon>
  );
}
