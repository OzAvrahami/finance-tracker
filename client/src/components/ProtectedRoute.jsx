import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/auth-context';
import { PrimaryButton } from './ui';
import './ProtectedRoute.css';

const ProtectedRoute = ({ children }) => {
  const { user, loading, authError, retryAuth } = useAuth();

  if (authError) {
    return <div className="protected-route-loading protected-route-error" dir="rtl">
      <p role="alert">{authError}</p>
      <PrimaryButton type="button" onClick={retryAuth}>ניסיון חוזר</PrimaryButton>
    </div>;
  }

  if (loading) {
    return (
      <div
        className="protected-route-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span
          className="ui-button-spinner protected-route-loading__spinner"
          aria-hidden="true"
        />
        <span>טוען...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
