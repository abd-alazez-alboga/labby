import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../layout/BrandMark';
import { LanguageSwitcher } from '../layout/LanguageSwitcher';

type LoginErrorKey =
  | 'auth.errors.invalidCredentials'
  | 'auth.errors.notAdmin'
  | 'auth.errors.throttled'
  | 'auth.errors.generic';

/** Maps the contract's login failures (auth-v1.yaml) to user-facing messages. */
function mapLoginError(error: unknown): LoginErrorKey {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'auth.errors.invalidCredentials';
    }
    if (error.status === 403) {
      return 'auth.errors.notAdmin';
    }
    if (error.status === 429) {
      return 'auth.errors.throttled';
    }
  }
  return 'auth.errors.generic';
}

export default function LoginPage() {
  const { t } = useTranslation();
  const { user, sessionExpired, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<LoginErrorKey | null>(null);

  // Where the guard sent us from — restored after a successful login.
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  // Already signed in (direct visit to /login): go straight home.
  if (user) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKey(null);
    try {
      await login(phone.trim(), password);
      navigate(from, { replace: true });
    } catch (error) {
      setErrorKey(mapLoginError(error));
      setSubmitting(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={(event) => void handleSubmit(event)}>
        <div className="login__brand">
          <BrandMark size="lg" />
          <span className="brand__name">{t('app.title')}</span>
        </div>
        <div>
          <h1 className="login__title">{t('auth.loginTitle')}</h1>
          <p className="login__subtitle">{t('auth.loginSubtitle')}</p>
        </div>

        {sessionExpired && errorKey === null ? (
          <p className="login__notice" role="status">
            {t('auth.sessionExpired')}
          </p>
        ) : null}
        {errorKey !== null ? (
          <p className="login__error" role="alert">
            {t(errorKey)}
          </p>
        ) : null}

        <div className="form-field">
          <label htmlFor="login-phone">{t('auth.phoneLabel')}</label>
          <input
            id="login-phone"
            type="tel"
            dir="ltr"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
            disabled={submitting}
          />
        </div>
        <div className="form-field">
          <label htmlFor="login-password">{t('auth.passwordLabel')}</label>
          <div className="form-field__password">
            <input
              id="login-password"
              type={passwordRevealed ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={submitting}
            />
            <button
              type="button"
              className="form-field__reveal"
              aria-label={t(passwordRevealed ? 'auth.hidePassword' : 'auth.showPassword')}
              aria-pressed={passwordRevealed}
              onClick={() => setPasswordRevealed((v) => !v)}
            >
              {passwordRevealed ? (
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
        </div>

        <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={submitting}>
          {submitting ? t('auth.submitting') : t('auth.submit')}
        </button>

        <div className="login__footer">
          <LanguageSwitcher />
        </div>
      </form>
    </div>
  );
}
