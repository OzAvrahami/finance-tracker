import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/auth-context';
import './ProtectedRoute.css';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

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
