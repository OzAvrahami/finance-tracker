import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Lock, Mail } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Alert, PrimaryButton, TextField } from '../../components/ui';

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

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '20px' }}>
          <TextField
            type="email"
            label="אימייל"
            value={email}
            onValueChange={setEmail}
            autoComplete="email"
            technicalLtr
            leading={<Mail size={18} aria-hidden="true" />}
            required
          />

          <TextField
            type="password"
            label="סיסמה"
            value={password}
            onValueChange={setPassword}
            autoComplete="current-password"
            technicalLtr
            leading={<Lock size={18} aria-hidden="true" />}
            required
          />

          {error && (
            <Alert variant="error" urgent>{error}</Alert>
          )}

          <PrimaryButton
            type="submit"
            size="lg"
            fullWidth
            loading={loading}
            loadingText="מתחבר..."
          >
            התחברות
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
};

export default Login;
