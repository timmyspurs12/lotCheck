import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, LoaderCircle, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, isApiError } from '../api/client';
import { clearDemoSessionToken, getDemoSessionToken, setDemoSessionToken } from './demoSession';

type AuthMode = 'disabled' | 'oidc' | 'demo';
type GateState = 'checking' | 'unavailable' | 'unauthenticated' | 'authenticated' | 'disabled' | 'oidc';

export function DemoAuthGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [state, setState] = useState<GateState>('checking');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    const onSessionExpired = () => {
      clearDemoSessionToken();
      setError('Your demo session expired. Please sign in again.');
      setState('unauthenticated');
    };
    window.addEventListener('lotcheck:demo-session-expired', onSessionExpired);
    const check = async () => {
      setState('checking');
      setError('');
      try {
        const result = await api.getAuthMode();
        if (!active) return;
        setMode(result.mode);
        if (result.mode === 'disabled') {
          setState('disabled');
          return;
        }
        if (result.mode === 'oidc') {
          setState('oidc');
          return;
        }
        if (!getDemoSessionToken()) {
          setState('unauthenticated');
          return;
        }
        try {
          await api.getAuthSession();
          if (active) setState('authenticated');
        } catch (sessionError) {
          if (!active) return;
          if (isApiError(sessionError) && sessionError.status === 401) {
            clearDemoSessionToken();
            setState('unauthenticated');
          } else {
            setError(messageFor(sessionError));
            setState('unavailable');
          }
        }
      } catch (modeError) {
        if (!active) return;
        setError(messageFor(modeError));
        setState('unavailable');
      }
    };
    void check();
    return () => {
      active = false;
      window.removeEventListener('lotcheck:demo-session-expired', onSessionExpired);
    };
  }, [retryKey]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !passcode) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.demoLogin(passcode);
      setDemoSessionToken(result.access_token);
      await api.getAuthSession();
      setPasscode('');
      setState('authenticated');
    } catch (loginError) {
      if (isApiError(loginError) && loginError.status === 401) {
        clearDemoSessionToken();
        setError('That passcode was not accepted. Check it and try again.');
      } else {
        setError(messageFor(loginError));
      }
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    clearDemoSessionToken();
    setPasscode('');
    setError('');
    setState(mode === 'demo' ? 'unauthenticated' : 'checking');
  }

  if (state === 'disabled') return <>{children}</>;
  if (state === 'authenticated') {
    return <>
      {children}
      {mode === 'demo' && <div className="demo-session-chip" role="status">
        <span><ShieldCheck size={14} aria-hidden="true" /> Demo access</span>
        <button type="button" onClick={signOut} aria-label="Sign out of the demo session"><LogOut size={14} aria-hidden="true" /> Sign out</button>
      </div>}
    </>;
  }

  if (state === 'checking') {
    return <main className="demo-auth-page" aria-live="polite"><div className="demo-auth-card demo-auth-loading"><LoaderCircle size={22} className="demo-auth-spinner" aria-hidden="true" /><p>Checking LotCheck access…</p></div></main>;
  }

  if (state === 'unavailable' && mode !== 'demo') {
    return <main className="demo-auth-page">
      <section className="demo-auth-card" aria-labelledby="demo-auth-title">
        <div className="demo-auth-icon"><RefreshCw size={23} aria-hidden="true" /></div>
        <p className="demo-auth-eyebrow">LOTcheck · connection</p>
        <h1 id="demo-auth-title">LotCheck is unavailable</h1>
        <p className="demo-auth-copy">The backend did not report its authentication mode. No access mode was assumed.</p>
        {error && <p className="demo-auth-error" role="alert">{error}</p>}
        <button className="demo-auth-submit" type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry connection</button>
      </section>
    </main>;
  }

  if (state === 'oidc') {
    return <main className="demo-auth-page">
      <section className="demo-auth-card" aria-labelledby="demo-auth-title">
        <div className="demo-auth-icon"><ShieldCheck size={23} aria-hidden="true" /></div>
        <p className="demo-auth-eyebrow">LOTcheck · protected access</p>
        <h1 id="demo-auth-title">Sign-in is managed by your identity provider</h1>
        <p className="demo-auth-copy">This deployment requires OIDC authentication. The LotCheck frontend has no built-in OIDC redirect provider; configure your approved sign-in integration rather than switching production authentication off.</p>
        {error && <p className="demo-auth-error" role="alert">{error}</p>}
      </section>
    </main>;
  }

  return <main className="demo-auth-page">
    <section className="demo-auth-card" aria-labelledby="demo-auth-title">
      <div className="demo-auth-icon"><KeyRound size={23} aria-hidden="true" /></div>
      <p className="demo-auth-eyebrow">LOTcheck · hackathon demo</p>
      <h1 id="demo-auth-title">Enter the demo passcode</h1>
      <p className="demo-auth-copy">Use the access passcode provided by the demo host. Your session is limited to this browser tab and expires automatically.</p>
      <form onSubmit={handleSubmit} className="demo-auth-form">
        <label htmlFor="demo-passcode">Demo passcode</label>
        <input
          id="demo-passcode"
          name="passcode"
          type="password"
          autoComplete="current-password"
          minLength={1}
          maxLength={256}
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          required
          disabled={busy}
        />
        {error && <p className="demo-auth-error" role="alert">{error}</p>}
        <button className="demo-auth-submit" type="submit" disabled={busy || !passcode}>
          {busy ? <><LoaderCircle size={16} className="demo-auth-spinner" aria-hidden="true" /> Verifying…</> : 'Continue to LotCheck'}
        </button>
      </form>
      <p className="demo-auth-footnote">Demo access is shared and is not a personal identity. Do not use production credentials.</p>
      {state === 'unavailable' && <button className="demo-auth-retry" type="button" onClick={() => setRetryKey((value) => value + 1)}><RefreshCw size={14} aria-hidden="true" /> Retry backend connection</button>}
    </section>
  </main>;
}

function messageFor(error: unknown) {
  return isApiError(error) ? error.message : 'LotCheck could not verify access. Check the backend connection and try again.';
}
