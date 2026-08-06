import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  user: null,
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ signIn: auth.signIn, user: auth.user }),
}));

const LoginRoutes = () => (
  <MemoryRouter initialEntries={['/login']}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<div>עמוד מוגן</div>} />
    </Routes>
  </MemoryRouter>
);

const renderLogin = () => render(<LoginRoutes />);

beforeEach(() => {
  auth.user = null;
  auth.signIn.mockReset();
  auth.signIn.mockResolvedValue({ error: null });
});

describe('Login C2a pilot', () => {
  it('renders associated fields with authentication autocomplete and protected password input', () => {
    renderLogin();
    const email = screen.getByRole('textbox', { name: 'אימייל' });
    const password = screen.getByLabelText(/סיסמה/);
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(email).toHaveAttribute('dir', 'ltr');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
  });

  it('submits the same email and password to the existing signIn callback', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByRole('textbox', { name: 'אימייל' }), 'user@example.com');
    await user.type(screen.getByLabelText(/סיסמה/), 'secret');
    await user.click(screen.getByRole('button', { name: 'התחברות' }));
    expect(auth.signIn).toHaveBeenCalledOnce();
    expect(auth.signIn).toHaveBeenCalledWith('user@example.com', 'secret');
  });

  it('keeps native Enter submission behavior', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByRole('textbox', { name: 'אימייל' }), 'enter@example.com');
    await user.type(screen.getByLabelText(/סיסמה/), 'secret{Enter}');
    expect(auth.signIn).toHaveBeenCalledWith('enter@example.com', 'secret');
  });

  it('disables and announces loading while sign-in is pending', async () => {
    auth.signIn.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByRole('textbox', { name: 'אימייל' }), 'user@example.com');
    await user.type(screen.getByLabelText(/סיסמה/), 'secret');
    await user.click(screen.getByRole('button', { name: 'התחברות' }));
    const loadingButton = screen.getByRole('button', { name: 'מתחבר...' });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the existing invalid-credentials meaning through the shared urgent Alert', async () => {
    auth.signIn.mockResolvedValue({ error: new Error('invalid credentials') });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByRole('textbox', { name: 'אימייל' }), 'bad@example.com');
    await user.type(screen.getByLabelText(/סיסמה/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'התחברות' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('שם משתמש או סיסמה שגויים');
    expect(screen.getByRole('button', { name: 'התחברות' })).toBeEnabled();
  });

  it('preserves user-driven redirect after successful authentication', async () => {
    const user = userEvent.setup();
    const view = renderLogin();
    await user.type(screen.getByRole('textbox', { name: 'אימייל' }), 'user@example.com');
    await user.type(screen.getByLabelText(/סיסמה/), 'secret');
    await user.click(screen.getByRole('button', { name: 'התחברות' }));
    auth.user = { id: 'user-1' };
    view.rerender(<LoginRoutes />);
    expect(screen.getByText('עמוד מוגן')).toBeInTheDocument();
  });

  it('does not introduce sign-up, password-reset, or password-reveal controls', () => {
    renderLogin();
    expect(screen.queryByText(/הרשמה|איפוס סיסמה|שכחתי/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /הצגת סיסמה/ })).not.toBeInTheDocument();
  });
});
