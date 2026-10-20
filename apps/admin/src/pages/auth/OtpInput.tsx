import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

export const OTP_LENGTH = 6;

/**
 * The 6-digit SMS code as six boxes (V1FAdminSetPassword step 2). Digits
 * only; typing advances, Backspace on an empty box steps back, and a pasted
 * code fills every box. Always laid out left-to-right, also in Arabic.
 * `value` holds one character per box, a space for an empty box.
 */
export function OtpInput({
  value,
  onChange,
  disabled = false,
  invalid = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, index) => (value[index] ?? '').trim());

  function emit(next: string[]) {
    onChange(
      next
        .map((digit) => digit || ' ')
        .join('')
        .trimEnd(),
    );
  }

  function focusBox(index: number) {
    boxes.current[Math.max(0, Math.min(OTP_LENGTH - 1, index))]?.focus();
  }

  /** Writes `typed` digits from box `index` on, then focuses the box after the last one. */
  function fill(index: number, typed: string) {
    const clean = typed.replace(/\D/g, '');
    if (clean === '') {
      return;
    }
    const next = [...digits];
    let cursor = index;
    for (const digit of clean) {
      if (cursor >= OTP_LENGTH) {
        break;
      }
      next[cursor] = digit;
      cursor += 1;
    }
    emit(next);
    focusBox(cursor);
  }

  function handleChange(index: number, typed: string) {
    if (typed === '') {
      const next = [...digits];
      next[index] = '';
      emit(next);
      return;
    }
    // A box that already held a digit receives it plus the new one: keep the new one.
    const current = digits[index];
    fill(index, current !== '' && typed.length > 1 ? typed.replace(current, '') : typed);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && digits[index] === '' && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      emit(next);
      focusBox(index - 1);
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    fill(index, event.clipboardData.getData('text'));
  }

  return (
    <div className="otp" role="group" aria-label={t('auth.reset.codeGroup')} dir="ltr">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          className={invalid ? 'otp__box otp__box--invalid' : 'otp__box'}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={t('auth.reset.digitLabel', { n: index + 1, total: OTP_LENGTH })}
          aria-invalid={invalid || undefined}
          value={digit}
          disabled={disabled}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
        />
      ))}
    </div>
  );
}
