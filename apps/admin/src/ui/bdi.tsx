import { Fragment, type ReactNode } from 'react';

/** Private-use delimiter: never typed by a user, never in a bundle string. */
const MARK = '\uE000';

/**
 * Marks a user-supplied value (a name) for {@link withBdi}: pass the result as the i18next
 * interpolation value, then hand the translated text to `withBdi`.
 */
export function bdiMark(value: string): string {
  return `${MARK}${value}${MARK}`;
}

/**
 * Renders translated text with every {@link bdiMark}ed value inside its own `<bdi>` (V1 audit
 * I107): an Arabic name inside an LTR template — or a Latin one inside Arabic — is isolated, so
 * the bidi algorithm cannot reorder the separators and digits around it.
 *
 * @example withBdi(t('rideDetail.parties.rider', { name: bdiMark(riderName) }))
 */
export function withBdi(text: string): ReactNode {
  if (!text.includes(MARK)) {
    return text;
  }
  return text
    .split(MARK)
    .map((part, index) =>
      index % 2 === 1 ? <bdi key={index}>{part}</bdi> : <Fragment key={index}>{part}</Fragment>,
    );
}
