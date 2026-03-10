import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) setError(error.message);
    setLoading(false);
  };

  return (
    <div style={styles.wrapper}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0e1a; }
        input:-webkit-autofill { -webkit-box-shadow: 0 0 0px 1000px #1e293b inset; -webkit-text-fill-color: #e2e8f0; }
      `}</style>

      <div style={styles.card}>
        <div style={styles.logo}>☀️</div>
        <div style={styles.title}>SOLAR INVERTER ERP</div>
        <div style={styles.subtitle}>Sign in to your account</div>

        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Email Address</label>
            <input
              style={styles.input}
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              style={styles.input}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button style={{ ...styles.btn, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>

        <div style={styles.footer}>
          Secure access · Only authorised users can log in
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    background: '#0a0e1a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'DM Sans', sans-serif",
  },
  card: {
    background: 'linear-gradient(135deg,#1e293b 0%,#0f172a 100%)',
    border: '1px solid #334155',
    borderRadius: 20,
    padding: '48px 40px',
    width: 400,
    textAlign: 'center',
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  },
  logo: { fontSize: 40, marginBottom: 16 },
  title: {
    fontFamily: "'DM Mono', monospace",
    fontSize: 14,
    color: '#f59e0b',
    letterSpacing: '0.12em',
    marginBottom: 6,
  },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 32 },
  form: { display: 'flex', flexDirection: 'column', gap: 18, textAlign: 'left' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: {
    fontSize: 11,
    fontFamily: "'DM Mono', monospace",
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: '#64748b',
  },
  input: {
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '12px 14px',
    color: '#e2e8f0',
    fontSize: 14,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  error: {
    background: '#450a0a',
    border: '1px solid #7f1d1d',
    color: '#f87171',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    fontFamily: "'DM Mono', monospace",
  },
  btn: {
    background: '#f59e0b',
    color: '#0a0e1a',
    fontWeight: 700,
    border: 'none',
    borderRadius: 10,
    padding: '14px',
    fontSize: 14,
    fontFamily: "'DM Mono', monospace",
    cursor: 'pointer',
    letterSpacing: '0.05em',
    marginTop: 4,
    transition: 'opacity 0.2s',
  },
  footer: { marginTop: 24, fontSize: 11, color: '#334155' },
};
