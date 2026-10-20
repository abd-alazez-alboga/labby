import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { completePasswordReset, startPasswordReset, verifyPasswordReset } from '../api/auth';
import { ApiError, createApiClient } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { normalizePhone } from '../auth/phone';
import { useConfig } from '../config/ConfigContext';
import { AlertIcon, BackIcon } from './auth/auth-icons';
import { OTP_LENGTH, OtpInput } from './auth/OtpInput';
import { PasswordInput } from './auth/PasswordInput';
import type { LoginLocationState } from './LoginPage';

/** AUTH-04: 60 s between two codes for one phone. */
export const RESEND_COOLDOWN_SECONDS = 60;
/** auth-v1 Password: 8–72 characters. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
/** auth-v1 PhoneInput: the canonical E.164 form the server accepts. */
const E164 = /^\+[1-9][0-9]{7,14}$/;

type Step = 'phone' | 'code' | 'password';

type StepError =
  | 'auth.reset.errors.phoneInvalid'
  | 'auth.reset.errors.wrongCode'
  | 'auth.reset.errors.codeExpired'
  | 'auth.reset.errors.tooShort'
  | 'auth.reset.errors.mismatch'
  | 'auth.reset.errors.resetExpired'
  | 'auth.errors.generic';

/** Counts the resend cooldown down once per second; `start()` re-arms it. */
function useCooldown(seconds: number) {
  const [left, setLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    setLeft(seconds);
    timer.current = setInterval(() => {
      setLeft((current) => {
        if (current <= 1) {
          stop();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  }, [seconds, stop]);

  useEffect(() => stop, [stop]);
  return { left, start };
}

function digitsOnly(code: string): string | null {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code) ? code : null;
}

/**
 * Set or reset the admin's password (UC-A-01 / AUTH-06 for a new admin,
 * UC-S-04 for a forgotten one; V1 audit H2, board V1FAdminSetPassword):
 * phone → 6-digit SMS code → new password + confirm, on the auth-v1
 * password-reset rail. Reachable signed out. The start step always answers
 * 204 (no account enumeration), so the copy stays neutral; a finished reset
 * revokes every session and lands back on Sign in with the phone pre-filled.
 */
export default function SetPasswordPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const config = useConfig();
  const navigate = useNavigate();
  // Signed out: the plain client (no bearer token, no refresh).
  const client = useMemo(() => createApiClient(config), [config]);
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS);

  const [step, setStep] = useState<Step>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StepError | null>(null);

  if (user) {
    return <Navigate to="/" replace />;
  }

  /** Sends (or re-sends) the code; the answer is 204 whether or not the phone has an account. */
  async function sendCode(target: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await startPasswordReset(client, target);
      cooldown.start();
      return true;
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 400
          ? 'auth.reset.errors.phoneInvalid'
          : 'auth.errors.generic',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const canonical = normalizePhone(phoneInput);
    if (!E164.test(canonical)) {
      setError('auth.reset.errors.phoneInvalid');
      return;
    }
    if (await sendCode(canonical)) {
      setPhone(canonical);
      setCode('');
      setStep('code');
    }
  }

  async function resend() {
    if (await sendCode(phone)) {
      setCode('');
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const complete = digitsOnly(code);
    if (complete === null) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const verified = await verifyPasswordReset(client, phone, complete);
      setResetToken(verified.resetToken);
      setPassword('');
      setConfirm('');
      setStep('password');
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 400
          ? 'auth.reset.errors.wrongCode'
          : failure instanceof ApiError && failure.status === 410
            ? 'auth.reset.errors.codeExpired'
            : 'auth.errors.generic',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Checked before anything is sent (board state "passwords differ").
    if (password.length < PASSWORD_MIN) {
      setError('auth.reset.errors.tooShort');
      return;
    }
    if (password !== confirm) {
      setError('auth.reset.errors.mismatch');
      return;
    }
    if (resetToken === null) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completePasswordReset(client, resetToken, password);
      const state: LoginLocationState = { passwordSet: true, phone };
      navigate('/login', { replace: true, state });
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 400
          ? 'auth.reset.errors.resetExpired'
          : 'auth.errors.generic',
      );
      setBusy(false);
    }
  }

  function restart() {
    setError(null);
    setResetToken(null);
    setCode('');
    setStep('phone');
  }

  const stepNumber = step === 'phone' ? 1 : step === 'code' ? 2 : 3;
  const errorBanner = error ? (
    <p className="login__error login__error--icon" role="alert">
      <AlertIcon />
      <span>{t(error)}</span>
    </p>
  ) : null;

  const header = (
    <>
      <Link className="login__back" to="/login">
        <BackIcon />
        {t('auth.reset.back')}
      </Link>
      <div className="login__progress">
        <span className="login__step">{t('auth.reset.step', { n: stepNumber, total: 3 })}</span>
        <div className="login__bars" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={n <= stepNumber ? 'login__bar login__bar--done' : 'login__bar'}
            />
          ))}
        </div>
      </div>
    </>
  );

  return (
    <div className="login">
      {step === 'phone' ? (
        <form className="login__card" onSubmit={(event) => void submitPhone(event)} noValidate>
          {header}
          <div>
            <h1 className="login__heading">{t('auth.reset.title')}</h1>
            <p className="login__lead">{t('auth.reset.intro')}</p>
          </div>
          {errorBanner}
          <div className="form-field">
            <label htmlFor="reset-phone">{t('auth.phoneLabel')}</label>
            <input
              id="reset-phone"
              type="tel"
              dir="ltr"
              autoComplete="tel"
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value)}
              required
              disabled={busy}
            />
          </div>
          <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
            {t('auth.reset.sendCode')}
          </button>
          <p className="login__hint">{t('auth.reset.sentHint')}</p>
        </form>
      ) : step === 'code' ? (
        <form className="login__card" onSubmit={(event) => void submitCode(event)}>
          {header}
          <div>
            <h1 className="login__heading">{t('auth.reset.codeTitle')}</h1>
            <p className="login__lead">
              {t('auth.reset.codeSent')}{' '}
              <bdi className="login__phone" dir="ltr">
                {phone}
              </bdi>
              {t('auth.reset.codeSentEnd')}{' '}
              <button
                className="login__inline-link"
                type="button"
                onClick={() => {
                  setError(null);
                  setStep('phone');
                }}
              >
                {t('auth.reset.changeNumber')}
              </button>
            </p>
          </div>
          <OtpInput
            value={code}
            onChange={setCode}
            disabled={busy}
            invalid={error === 'auth.reset.errors.wrongCode'}
          />
          {errorBanner}
          {error === 'auth.reset.errors.codeExpired' ? (
            <button
              className="btn login__secondary"
              type="button"
              disabled={busy}
              onClick={() => void resend()}
            >
              {t('auth.reset.sendNewCode')}
            </button>
          ) : null}
          <button
            className="btn btn--primary btn--lg btn--block"
            type="submit"
            disabled={busy || digitsOnly(code) === null}
          >
            {t('auth.reset.continue')}
          </button>
          <button
            className="login__resend"
            type="button"
            disabled={busy || cooldown.left > 0}
            onClick={() => void resend()}
          >
            {cooldown.left > 0
              ? t('auth.reset.resendIn', { seconds: cooldown.left })
              : t('auth.reset.resend')}
          </button>
        </form>
      ) : (
        <form className="login__card" onSubmit={(event) => void submitPassword(event)} noValidate>
          {header}
          <div>
            <h1 className="login__heading">{t('auth.reset.passwordTitle')}</h1>
            <p className="login__lead">{t('auth.reset.passwordIntro')}</p>
          </div>
          <div className="form-field">
            <label htmlFor="reset-password">{t('auth.reset.newPassword')}</label>
            <PasswordInput
              id="reset-password"
              autoComplete="new-password"
              value={password}
              onChange={(next) => setPassword(next.slice(0, PASSWORD_MAX))}
              disabled={busy}
              describedBy="reset-password-hint"
            />
            <span id="reset-password-hint" className="login__hint">
              {t('auth.reset.passwordHint', { min: PASSWORD_MIN })}
            </span>
          </div>
          <div className="form-field">
            <label htmlFor="reset-confirm">{t('auth.reset.confirmPassword')}</label>
            <PasswordInput
              id="reset-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(next) => setConfirm(next.slice(0, PASSWORD_MAX))}
              disabled={busy}
            />
          </div>
          {errorBanner}
          {error === 'auth.reset.errors.resetExpired' ? (
            <button className="btn login__secondary" type="button" onClick={restart}>
              {t('auth.reset.startAgain')}
            </button>
          ) : null}
          <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
            {t('auth.reset.setPassword')}
          </button>
          <p className="login__hint">{t('auth.reset.signsOut')}</p>
        </form>
      )}
    </div>
  );
}
