import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, user } = useAuth();

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      setError('שם משתמש או סיסמה שגויים');
      setLoading(false);
    }
  };

  return (
    <div dir="rtl" style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--bg)',
      fontFamily: 'var(--font-ui)',
    }}>
      <div style={{
        backgroundColor: 'var(--surface-1)',
        padding: '40px',
        borderRadius: 'var(--r-16)',
        boxShadow: 'var(--shadow-md)',
        width: '100%',
        maxWidth: '400px',
        border: '1px solid var(--border)',
      }}>
        <h1 style={{
          textAlign: 'center',
          color: 'var(--ink-1)',
          marginBottom: '30px',
          fontSize: 'var(--fs-24)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
        }}>
          MyFinance
        </h1>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '6px', color: 'var(--ink-3)', fontSize: 'var(--fs-14)', fontWeight: 500 }}>
              אימייל
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 'var(--r-8)',
                border: '1px solid var(--border-strong)',
                fontSize: 'var(--fs-14)',
                boxSizing: 'border-box',
                backgroundColor: 'var(--surface-2)',
                color: 'var(--ink-1)',
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '6px', color: 'var(--ink-3)', fontSize: 'var(--fs-14)', fontWeight: 500 }}>
              סיסמה
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 'var(--r-8)',
                border: '1px solid var(--border-strong)',
                fontSize: 'var(--fs-14)',
                boxSizing: 'border-box',
                backgroundColor: 'var(--surface-2)',
                color: 'var(--ink-1)',
              }}
            />
          </div>

          {error && (
            <div style={{
              color: 'var(--neg)',
              marginBottom: '15px',
              textAlign: 'center',
              fontSize: 'var(--fs-13)',
              backgroundColor: 'var(--neg-soft)',
              borderRadius: 'var(--r-8)',
              padding: '8px 12px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="ui-btn-primary"
            style={{
              width: '100%',
              padding: '12px',
              background: 'var(--primary-grad)',
              color: 'var(--primary-ink)',
              border: 'none',
              borderRadius: 'var(--r-8)',
              fontSize: 'var(--fs-14)',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'מתחבר...' : 'התחברות'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
