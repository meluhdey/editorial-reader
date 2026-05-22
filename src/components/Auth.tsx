import { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface AuthProps {
  initialMode?: 'signin' | 'signup';
  onSuccess: () => void;
  onCancel?: () => void;
  onGuestBypass?: () => void;
}

export default function Auth({ initialMode = 'signin', onSuccess, onCancel, onGuestBypass }: AuthProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSuccessMsg, setIsSuccessMsg] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);

  // Focus on the first field when switching modes or mounting
  useEffect(() => {
    if (mode === 'signup') {
      firstNameRef.current?.focus();
    } else {
      emailRef.current?.focus();
    }
    setErrorMsg(null);
    setIsSuccessMsg(false);
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setErrorMsg(null);
    setIsSuccessMsg(false);

    try {
      if (mode === 'signup') {
        if (!firstName.trim() || !lastName.trim()) {
          throw new Error('Please fill in both first name and last name.');
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
            }
          }
        });

        if (error) throw error;

        if (data.session) {
          onSuccess();
        } else {
          // No session returned: either user created but email verification is active,
          // or user already exists (handled with standard response to prevent user enumeration).
          setErrorMsg('A verification link has been sent to your email address. Please check your inbox to verify your account (if you already have an account, please sign in).');
          setIsSuccessMsg(true);
          setFirstName('');
          setLastName('');
          setEmail('');
          setPassword('');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
        onSuccess();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during authentication.');
      setIsSuccessMsg(false);
    } finally {
      setLoading(false);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const el = e.target;
    // Sync aria-invalid with the :user-invalid state
    setTimeout(() => {
      if (el) {
        const isUserInvalid = el.classList.contains('user-invalid-fallback') || el.matches?.(':user-invalid');
        el.setAttribute('aria-invalid', isUserInvalid ? 'true' : 'false');
      }
    }, 50);
  };

  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    const el = e.target as HTMLInputElement;
    if (el.hasAttribute('aria-invalid')) {
      setTimeout(() => {
        const isUserInvalid = el.classList.contains('user-invalid-fallback') || el.matches?.(':user-invalid');
        el.setAttribute('aria-invalid', isUserInvalid ? 'true' : 'false');
      }, 50);
    }
  };

  return (
    <div className="auth-container">
      {onCancel && (
        <button className="auth-back-btn" onClick={onCancel} aria-label="Go back">
          <ArrowLeft size={16} />
          <span>BACK TO LIBRARY</span>
        </button>
      )}

      <div className="auth-card">
        <div className="auth-header">
          <span className="auth-logo-sub">FOOTNOTES</span>
          <h1 className="auth-title">{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
          <p className="auth-subtitle">
            {mode === 'signin'
              ? 'Access your personal footnotes, highlights, and saved articles.'
              : 'Start your cloud-synced footnotes space today.'}
          </p>
        </div>

        {errorMsg && (
          <div className={`auth-alert ${isSuccessMsg ? 'success' : 'error'}`} role="alert">
            <span className="auth-alert-icon">{isSuccessMsg ? '✓' : '✦'}</span>
            <span className="auth-alert-text">{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" noValidate={false}>
          {mode === 'signup' && (
            <div className="auth-name-grid">
              <div className="auth-field">
                <label htmlFor="auth-firstname">FIRST NAME</label>
                <input
                  ref={firstNameRef}
                  type="text"
                  id="auth-firstname"
                  name="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  onBlur={handleBlur}
                  onInput={handleInput}
                  placeholder="First name"
                  required
                  disabled={loading}
                />
              </div>
              <div className="auth-field">
                <label htmlFor="auth-lastname">LAST NAME</label>
                <input
                  type="text"
                  id="auth-lastname"
                  name="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  onBlur={handleBlur}
                  onInput={handleInput}
                  placeholder="Last name"
                  required
                  disabled={loading}
                />
              </div>
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="auth-email">EMAIL ADDRESS</label>
            <input
              ref={emailRef}
              type="email"
              id="auth-email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={handleBlur}
              onInput={handleInput}
              placeholder="you@example.com"
              required
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="auth-field">
            <div className="auth-label-row">
              <label htmlFor="auth-password">PASSWORD</label>
            </div>
            <div className="auth-password-wrapper">
              <input
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                id="auth-password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={handleBlur}
                onInput={handleInput}
                placeholder={mode === 'signin' ? '••••••••' : 'At least 6 characters'}
                required
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                disabled={loading}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                <span>{mode === 'signin' ? 'SIGNING IN...' : 'CREATING ACCOUNT...'}</span>
              </>
            ) : (
              <span>{mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}</span>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              className="auth-toggle-mode-btn"
              onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
              disabled={loading}
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>

        {onGuestBypass && (
          <div className="auth-bypass-container">
            <div className="auth-bypass-divider">
              <span>OR</span>
            </div>
            <button
              type="button"
              className="auth-bypass-btn"
              onClick={onGuestBypass}
              disabled={loading}
            >
              ✦ ENTER AS LOCAL GUEST (OFFLINE) ✦
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
