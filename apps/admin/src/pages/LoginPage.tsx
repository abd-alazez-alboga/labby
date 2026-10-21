import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { normalizePhone } from '../auth/phone';
import { BrandMark } from '../layout/BrandMark';
import { LanguageSwitcher } from '../layout/LanguageSwitcher';
import { PasswordInput } from './auth/PasswordInput';
import { CheckIcon, LockIcon } from './auth/auth-icons';

type LoginErrorKey =
  | 'auth.errors.invalidCredentials'
  | 'auth.errors.notAdmin'
  | 'auth.errors.throttled'
  | 'auth.errors.generic';

/** What other screens hand the sign-in page through router state. */
export interface LoginLocationState {
  /** Where the guard sent us from — restored after a successful login. */
  from?: { pathname?: string };
  /** The set/reset password flow just finished (V1 audit H2): banner + pre-filled phone. */
  passwordSet?: boolean;
  phone?: string;
}

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
  const state = location.state as LoginLocationState | null;
  const passwordSet = state?.passwordSet === true;
  const [phone, setPhone] = useState(passwordSet ? (state?.phone ?? '') : '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<LoginErrorKey | null>(null);

  const from = state?.from?.pathname ?? '/';

  // Already signed in (direct visit to /login): go straight home.
  if (user) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKey(null);
    try {
      await login(normalizePhone(phone), password);
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
          <BrandMark variant="logo" />
        </div>
        <div>
          <h1 className="login__title">{t('auth.loginTitle')}</h1>
          <p className="login__subtitle">{t('auth.loginSubtitle')}</p>
        </div>

        {passwordSet && errorKey === null ? (
          <p className="login__success" role="status">
            <CheckIcon />
            {t('auth.reset.passwordSet')}
          </p>
        ) : sessionExpired && errorKey === null ? (
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
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            disabled={submitting}
          />
        </div>

        <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={submitting}>
          {submitting ? t('auth.submitting') : t('auth.submit')}
        </button>
        {/* UC-A-01 / AUTH-06: a new admin sets, a locked-out admin resets, their password (H2). */}
        <Link className="login__link" to="/set-password">
          <LockIcon />
          {t('auth.reset.link')}
        </Link>

        <div className="login__footer">
          <LanguageSwitcher />
        </div>
      </form>
    </div>
  );
}
