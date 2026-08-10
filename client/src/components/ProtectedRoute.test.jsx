import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProtectedRoute from './ProtectedRoute';

const auth = vi.hoisted(() => ({
  loading: false,
  user: null,
}));

vi.mock('../context/auth-context', () => ({
  useAuth: () => auth,
}));

const renderProtectedRoute = () => render(
  <MemoryRouter initialEntries={['/private']}>
    <Routes>
      <Route path="/login" element={<div>מסך כניסה</div>} />
      <Route
        path="/private"
        element={(
          <ProtectedRoute>
            <div>תוכן מוגן</div>
          </ProtectedRoute>
        )}
      />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  auth.loading = false;
  auth.user = null;
});

describe('ProtectedRoute', () => {
  it('announces the theme-aware loading state', () => {
    auth.loading = true;

    renderProtectedRoute();

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('טוען...');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveClass('protected-route-loading');
  });

  it('redirects unauthenticated users to login', () => {
    renderProtectedRoute();

    expect(screen.getByText('מסך כניסה')).toBeInTheDocument();
    expect(screen.queryByText('תוכן מוגן')).not.toBeInTheDocument();
  });

  it('renders protected content for an authenticated user', () => {
    auth.user = { id: 'user-1' };

    renderProtectedRoute();

    expect(screen.getByText('תוכן מוגן')).toBeInTheDocument();
  });
});
