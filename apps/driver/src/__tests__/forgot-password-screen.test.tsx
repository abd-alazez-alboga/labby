import { renderRouter, screen } from 'expo-router/testing-library';
import { fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ForgotPasswordScreen } from '../components/auth/forgot-password-screen';
import { initI18n, setAppLanguage } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { installContractFetch } from '../test-utils/contract';
import type { ContractFetch } from '../test-utils/contract';

const PHONE = '+963900000005';

function renderReset() {
  renderRouter(
    {
      index: () => (
        <LocaleProvider initialLanguage="en">
          <ForgotPasswordScreen />
        </LocaleProvider>
      ),
      login: () => <Text testID="login-route">login</Text>,
    },
    { initialUrl: '/' },
  );
}

async function reachCodeStep(contract: ContractFetch) {
  renderReset();
  fireEvent.changeText(screen.getByTestId('reset-phone'), PHONE);
  fireEvent.press(screen.getByTestId('reset-send-code'));
  await screen.findByTestId('reset-step-code');
  expect(
    contract.requestsTo('POST /api/v1/auth/password-reset/start')[0].body,
  ).toEqual({ phone: PHONE });
}

describe('ForgotPasswordScreen (UC-S-04)', () => {
  beforeEach(async () => {
    await initI18n();
    await setAppLanguage('en');
  });

  it('walks the 3 steps with a neutral sent message and ends at login', async () => {
    const contract = installContractFetch({
      'POST /api/v1/auth/password-reset/start': { status: 204 },
      'POST /api/v1/auth/password-reset/verify': {
        status: 200,
        body: { resetToken: 'reset-token-1' },
      },
      'POST /api/v1/auth/password-reset/complete': { status: 204 },
    });

    await reachCodeStep(contract);
    // Neutral copy — no account enumeration.
    expect(
      screen.getByText('If this number is registered, we sent it a 6-digit code.'),
    ).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('reset-code'), '123456');
    fireEvent.press(screen.getByTestId('reset-verify'));
    await screen.findByTestId('reset-step-password');
    expect(
      contract.requestsTo('POST /api/v1/auth/password-reset/verify')[0].body,
    ).toEqual({ phone: PHONE, code: '123456' });

    fireEvent.changeText(screen.getByTestId('reset-new-password'), 'newpass99');
    fireEvent.press(screen.getByTestId('reset-complete'));
    await screen.findByTestId('reset-step-done');
    expect(
      contract.requestsTo('POST /api/v1/auth/password-reset/complete')[0].body,
    ).toEqual({ resetToken: 'reset-token-1', newPassword: 'newpass99' });

    fireEvent.press(screen.getByTestId('reset-go-login'));
    expect(await screen.findByTestId('login-route')).toBeTruthy();
  });

  it('shows the wrong-code error on 400 and stays on the code step', async () => {
    const contract = installContractFetch({
      'POST /api/v1/auth/password-reset/start': { status: 204 },
      'POST /api/v1/auth/password-reset/verify': {
        status: 400,
        body: { status: 400, message: 'wrong code' },
      },
    });
    await reachCodeStep(contract);

    fireEvent.changeText(screen.getByTestId('reset-code'), '000000');
    fireEvent.press(screen.getByTestId('reset-verify'));

    await screen.findByTestId('reset-error');
    expect(screen.getByText('That code is not correct. Try again.')).toBeTruthy();
    expect(screen.getByTestId('reset-step-code')).toBeTruthy();
  });

  it('shows the expired error on 410 with resend available', async () => {
    const contract = installContractFetch({
      'POST /api/v1/auth/password-reset/start': { status: 204 },
      'POST /api/v1/auth/password-reset/verify': {
        status: 410,
        body: { status: 410, message: 'expired' },
      },
    });
    await reachCodeStep(contract);

    fireEvent.changeText(screen.getByTestId('reset-code'), '123456');
    fireEvent.press(screen.getByTestId('reset-verify'));

    await screen.findByTestId('reset-error');
    expect(
      screen.getByText(
        'That code expired or was tried too many times. Request a new one.',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('reset-resend')).toBeTruthy();
  });

  it('shows the invalid-reset error when complete answers 400', async () => {
    const contract = installContractFetch({
      'POST /api/v1/auth/password-reset/start': { status: 204 },
      'POST /api/v1/auth/password-reset/verify': {
        status: 200,
        body: { resetToken: 'reset-token-1' },
      },
      'POST /api/v1/auth/password-reset/complete': {
        status: 400,
        body: { status: 400, message: 'expired token' },
      },
    });
    await reachCodeStep(contract);

    fireEvent.changeText(screen.getByTestId('reset-code'), '123456');
    fireEvent.press(screen.getByTestId('reset-verify'));
    await screen.findByTestId('reset-step-password');

    fireEvent.changeText(screen.getByTestId('reset-new-password'), 'newpass99');
    fireEvent.press(screen.getByTestId('reset-complete'));

    await screen.findByTestId('reset-error');
    expect(
      screen.getByText('The reset could not be completed. Please start over.'),
    ).toBeTruthy();
  });
});
