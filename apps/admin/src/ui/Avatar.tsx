import { initials } from './initials';

/** Round initials avatar on the accent tint. Decorative: the name is always shown beside it. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
