import { useEffect, useState } from 'react';
import { supabase } from '../config/supabase';
import { AuthContext } from './auth-context';

// Compatibility export: application consumers now import the hook from its
// Fast Refresh-safe module, while existing external imports remain valid.
// eslint-disable-next-line react-refresh/only-export-components
export { useAuth } from './auth-context';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true, bootstrapCurrent = true;
    const fail = () => {
      if (!active || !bootstrapCurrent) return;
      setAuthError('לא ניתן להשלים את בדיקת ההתחברות. בדקו שחיבור הרשת ושירות ההתחברות זמינים ונסו שוב.');
      setLoading(false);
    };
    // getSession can wait on token refresh/retries when the auth service is down.
    // Bound the loading UI without clearing stored sessions or bypassing auth.
    const timeout = setTimeout(fail, 15_000);
    Promise.resolve().then(() => supabase.auth.getSession()).then(({ data, error }) => {
      if (!active || !bootstrapCurrent) return;
      clearTimeout(timeout);
      if (error) { fail(); return; }
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setAuthError(null); setLoading(false);
    }).catch(() => { clearTimeout(timeout); fail(); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!active) return;
        setSession(session);
        setUser(session?.user ?? null);
        if (session || event === 'SIGNED_OUT') {
          bootstrapCurrent = false; clearTimeout(timeout);
          setAuthError(null); setLoading(false);
        }
      }
    );

    return () => { active = false; clearTimeout(timeout); subscription.unsubscribe(); };
  }, [attempt]);

  const retryAuth = () => { setLoading(true); setAuthError(null); setAttempt(current => current + 1); };

  const signIn = (email, password) => {
    return supabase.auth.signInWithPassword({ email, password });
  };

  const signUp = (email, password) => {
    return supabase.auth.signUp({ email, password });
  };

  const signOut = () => {
    return supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, authError, retryAuth, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
