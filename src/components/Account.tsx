import { type FormEvent, useEffect, useRef, useState } from 'react';
import { type Account, signIn, signOut, signUp } from '../account';

/** Sign in / create account, as a dialog over the game. */
function AuthDialog({ onDone, onClose }: { onDone: (a: Account) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => first.current?.focus(), [mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = mode === 'signup' ? await signUp(email, name, password) : await signIn(email, password);
      if (user) onDone(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signup = mode === 'signup';
  return (
    <div className="auth-backdrop" onClick={onClose}>
      <form
        className="auth"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id="auth-title" className="auth__title">
          {signup ? 'Create your account' : 'Sign in'}
        </h2>
        <p className="auth__lead">
          {signup ? 'An account lets you suggest changes to Pitwall and follow them.' : 'Welcome back to the pit wall.'}
        </p>

        {signup && (
          <label className="auth__field">
            <span>Name</span>
            <input ref={first} value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required autoComplete="nickname" />
          </label>
        )}
        <label className="auth__field">
          <span>Email</span>
          <input
            ref={signup ? undefined : first}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label className="auth__field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoComplete={signup ? 'new-password' : 'current-password'}
          />
          {signup && <small>At least 8 characters.</small>}
        </label>

        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="auth__submit" disabled={busy}>
          {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
        </button>
        <button
          type="button"
          className="auth__switch"
          onClick={() => {
            setMode(signup ? 'signin' : 'signup');
            setError(null);
          }}
        >
          {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
        <button type="button" className="auth__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </form>
    </div>
  );
}

/** The account chip in the side panel: "Sign in", or the player's name with "Sign out". */
export function AccountChip({
  account,
  onChange,
  open,
  setOpen,
}: {
  account: Account | null | undefined;
  onChange: (a: Account | null) => void;
  /** Whether the sign-in dialog is showing (other parts of the game can open it too). */
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  if (account === undefined) return null;
  if (account) {
    return (
      <div className="account">
        <span className="account__name" title={account.email}>
          {account.name}
        </span>
        <button type="button" className="account__btn" onClick={() => signOut().finally(() => onChange(null))}>
          Sign out
        </button>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="account__btn account__btn--primary" onClick={() => setOpen(true)}>
        Sign in
      </button>
      {open && (
        <AuthDialog
          onClose={() => setOpen(false)}
          onDone={(a) => {
            setOpen(false);
            onChange(a);
          }}
        />
      )}
    </>
  );
}
