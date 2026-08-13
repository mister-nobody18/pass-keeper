import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import PasswordStrengthMeter from '../components/ui/PasswordStrengthMeter.jsx';
import RecoveryKeyDisplay from '../components/RecoveryKeyDisplay.jsx';
import { setVaultKey } from '../crypto/vaultKeyStore.js';
import { cn } from '../utils/cn.js';

const LOGIN_PHASE_LABEL = { deriving: 'Deriving key…', verifying: 'Signing in…', upgrading: 'Upgrading your vault…' };
const SIGNUP_PHASE_LABEL = { deriving: 'Deriving key…', creating: 'Creating account…' };

// Both forms live in the DOM at once (needed for the sliding overlay to make
// sense - see index.css's prefers-reduced-motion note for the one bit of
// supporting CSS this page needs). `inert` on the inactive panel, not just
// dimming it, is what actually keeps keyboard/AT focus out of a form that's
// only visually covered by the gradient overlay - see App.jsx's LockGate for
// the same pattern used elsewhere in this app.
export default function Auth() {
    const location = useLocation();
    const navigate = useNavigate();
    const { login, completeTwoFactor, register, setUser } = useAuth();
    const [mode, setMode] = useState(location.pathname === '/register' ? 'signup' : 'login');

    // Keeps `mode` correct if the URL changes some other way (browser back/
    // forward, a direct link) - switchMode() below is what drives the common
    // case (clicking the CTA), this just keeps the two in sync regardless.
    useEffect(() => {
        setMode(location.pathname === '/register' ? 'signup' : 'login');
    }, [location.pathname]);

    function switchMode(next) {
        setMode(next);
        navigate(next === 'signup' ? '/register' : '/login', { replace: true });
    }

    const loginEmailRef = useRef(null);
    const signupEmailRef = useRef(null);
    useEffect(() => {
        (mode === 'login' ? loginEmailRef : signupEmailRef).current?.focus();
    }, [mode]);

    // --- Login ---
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [showLoginPassword, setShowLoginPassword] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [loginPhase, setLoginPhase] = useState(null);
    const loginSubmitting = loginPhase !== null;

    async function handleLoginSubmit(e) {
        e.preventDefault();
        setLoginError('');
        try {
            const result = await login(loginEmail, loginPassword, setLoginPhase);
            if (result?.twoFactorRequired) {
                setTwoFactorPending({ passwordWrapKey: result.passwordWrapKey });
            } else {
                navigate('/');
            }
        } catch (err) {
            setLoginError(err.message);
        } finally {
            setLoginPhase(null);
            setLoginPassword('');
        }
    }

    // --- 2FA challenge (after a password that needs a TOTP code to finish) ---
    const [twoFactorPending, setTwoFactorPending] = useState(null); // { passwordWrapKey } | null
    const [twoFactorCode, setTwoFactorCode] = useState('');
    const [rememberDevice, setRememberDevice] = useState(false);
    const [twoFactorError, setTwoFactorError] = useState('');
    const [twoFactorPhase, setTwoFactorPhase] = useState(null);
    const twoFactorSubmitting = twoFactorPhase !== null;

    async function handleTwoFactorSubmit(e) {
        e.preventDefault();
        setTwoFactorError('');
        setTwoFactorPhase('verifying');
        try {
            await completeTwoFactor(twoFactorCode, rememberDevice, twoFactorPending.passwordWrapKey, setTwoFactorPhase);
            navigate('/');
        } catch (err) {
            setTwoFactorError(err.message);
            setTwoFactorCode('');
        } finally {
            setTwoFactorPhase(null);
        }
    }

    // --- Signup ---
    const [signupEmail, setSignupEmail] = useState('');
    const [signupPassword, setSignupPassword] = useState('');
    const [signupConfirm, setSignupConfirm] = useState('');
    const [signupError, setSignupError] = useState('');
    const [signupPhase, setSignupPhase] = useState(null);
    const [recoveryKey, setRecoveryKey] = useState(null);
    const [pendingAuth, setPendingAuth] = useState(null);
    const signupSubmitting = signupPhase !== null;

    async function handleSignupSubmit(e) {
        e.preventDefault();
        setSignupError('');

        if (signupPassword.length < 10) {
            setSignupError('Master password must be at least 10 characters.');
            return;
        }
        if (signupPassword !== signupConfirm) {
            setSignupError('Passwords do not match.');
            return;
        }

        try {
            const result = await register(signupEmail, signupPassword, { onPhase: setSignupPhase });
            if (result.recoveryKey) {
                setPendingAuth({ user: result.user, dek: result.dek });
                setRecoveryKey(result.recoveryKey);
            } else {
                setVaultKey(result.dek);
                setUser(result.user);
                navigate('/');
            }
        } catch (err) {
            setSignupError(err.message);
        } finally {
            setSignupPhase(null);
            setSignupPassword('');
            setSignupConfirm('');
        }
    }

    if (twoFactorPending) {
        return (
            <div className="flex min-h-screen items-center justify-center p-4">
                <div className="w-full max-w-sm">
                    <div className="mb-8 flex flex-col items-center text-center">
                        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
                            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
                        </div>
                        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-tertiary">
                            Pass Keeper
                        </p>
                        <h1 className="text-xl font-semibold text-ink-primary">Two-factor authentication</h1>
                        <p className="mt-1.5 text-sm text-ink-secondary">
                            Enter the 6-digit code from your authenticator app.
                        </p>
                    </div>

                    <div className="rounded-2xl border border-line bg-surface-raised p-6 shadow-overlay sm:p-10">
                        <form onSubmit={handleTwoFactorSubmit} className="space-y-5" noValidate>
                            <Input
                                id="totp-code"
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                label="6-digit code"
                                required
                                autoFocus
                                maxLength={6}
                                disabled={twoFactorSubmitting}
                                leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                value={twoFactorCode}
                                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            />

                            <label className="flex items-start gap-2.5 text-sm text-ink-secondary">
                                <input
                                    type="checkbox"
                                    checked={rememberDevice}
                                    onChange={(e) => setRememberDevice(e.target.checked)}
                                    disabled={twoFactorSubmitting}
                                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-line bg-surface text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                />
                                <span>Remember this device for 30 days</span>
                            </label>

                            {twoFactorError && (
                                <div
                                    role="alert"
                                    className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                                >
                                    <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    <span>{twoFactorError}</span>
                                </div>
                            )}

                            <Button
                                type="submit"
                                variant="primary"
                                className="w-full"
                                loading={twoFactorSubmitting}
                                disabled={twoFactorCode.length !== 6}
                            >
                                {twoFactorSubmitting ? LOGIN_PHASE_LABEL[twoFactorPhase] ?? 'Verifying…' : 'Verify'}
                            </Button>
                        </form>

                        <button
                            type="button"
                            disabled={twoFactorSubmitting}
                            onClick={() => {
                                setTwoFactorPending(null);
                                setTwoFactorCode('');
                                setTwoFactorError('');
                            }}
                            className="mt-4 w-full rounded text-center text-sm text-ink-secondary transition-colors duration-fast hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            Back to sign in
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (recoveryKey) {
        return (
            <div className="flex min-h-screen items-center justify-center p-4">
                <div className="w-full max-w-sm">
                    <div className="mb-8 flex flex-col items-center text-center">
                        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
                            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
                        </div>
                        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-tertiary">
                            Pass Keeper
                        </p>
                        <h1 className="text-xl font-semibold text-ink-primary">Account created</h1>
                    </div>
                    <RecoveryKeyDisplay
                        recoveryKey={recoveryKey}
                        onContinue={() => {
                            setVaultKey(pendingAuth.dek);
                            setUser(pendingAuth.user);
                            navigate('/');
                        }}
                        continueLabel="Go to my vault"
                    />
                </div>
            </div>
        );
    }

    const panelTransition =
        'transition-[opacity,transform,filter] duration-[900ms] ease-[cubic-bezier(0.77,0,0.18,1)] motion-reduce:transition-none';

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-sm md:max-w-3xl">
                <div className="mb-8 flex flex-col items-center text-center">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
                        <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
                    </div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-tertiary">Pass Keeper</p>
                </div>

                <div className="relative grid overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-overlay md:min-h-[560px] md:grid-cols-2">
                    {/* Login panel - always the left grid slot on desktop */}
                    <div
                        inert={mode !== 'login' ? '' : undefined}
                        className={cn(
                            'flex-col justify-center p-6 sm:p-10 md:flex',
                            mode === 'login' ? 'flex' : 'hidden',
                            panelTransition,
                            mode === 'signup' && 'md:-translate-x-20 md:opacity-0 md:blur-md'
                        )}
                    >
                        <h1 className="text-xl font-semibold text-ink-primary">Sign in to your vault</h1>
                        <p className="mt-1.5 text-sm text-ink-secondary">
                            Encrypted end-to-end with your master password.
                        </p>

                        <form onSubmit={handleLoginSubmit} className="mt-6 space-y-5" noValidate>
                            <Input
                                id="login-email"
                                ref={loginEmailRef}
                                type="email"
                                label="Email"
                                required
                                autoComplete="email"
                                disabled={loginSubmitting}
                                leftIcon={<Mail size={16} aria-hidden="true" />}
                                value={loginEmail}
                                onChange={(e) => setLoginEmail(e.target.value)}
                            />

                            <div>
                                <div className="mb-1.5 flex items-center justify-between">
                                    <label htmlFor="login-password" className="text-sm font-medium text-ink-secondary">
                                        Master password
                                    </label>
                                    <button
                                        type="button"
                                        tabIndex={mode !== 'login' ? -1 : 0}
                                        onClick={() => navigate('/forgot-password')}
                                        className="rounded text-xs text-accent transition-colors duration-fast hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                        Forgot password?
                                    </button>
                                </div>
                                <Input
                                    id="login-password"
                                    type={showLoginPassword ? 'text' : 'password'}
                                    required
                                    autoComplete="current-password"
                                    disabled={loginSubmitting}
                                    leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                    rightSlot={
                                        <button
                                            type="button"
                                            onClick={() => setShowLoginPassword((v) => !v)}
                                            aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                                            aria-pressed={showLoginPassword}
                                            className="rounded p-1 text-ink-tertiary transition-colors duration-fast hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                        >
                                            {showLoginPassword ? (
                                                <EyeOff size={16} aria-hidden="true" />
                                            ) : (
                                                <Eye size={16} aria-hidden="true" />
                                            )}
                                        </button>
                                    }
                                    value={loginPassword}
                                    onChange={(e) => setLoginPassword(e.target.value)}
                                />
                            </div>

                            {loginError && (
                                <div
                                    role="alert"
                                    className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                                >
                                    <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    <span>{loginError}</span>
                                </div>
                            )}

                            <Button type="submit" variant="primary" className="w-full" loading={loginSubmitting}>
                                {loginSubmitting ? LOGIN_PHASE_LABEL[loginPhase] : 'Sign in'}
                            </Button>
                            {loginPhase === 'deriving' && (
                                <p className="text-center font-mono text-xs text-ink-tertiary" aria-live="polite">
                                    Running Argon2id locally in your browser — this takes a second.
                                </p>
                            )}
                        </form>

                        <p className="mt-6 text-center text-sm text-ink-secondary md:hidden">
                            Don't have an account?{' '}
                            <button
                                type="button"
                                onClick={() => switchMode('signup')}
                                className="rounded text-accent transition-colors duration-fast hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                Create one
                            </button>
                        </p>
                    </div>

                    {/* Signup panel - always the right grid slot on desktop */}
                    <div
                        inert={mode !== 'signup' ? '' : undefined}
                        className={cn(
                            'flex-col justify-center p-6 sm:p-10 md:col-start-2 md:flex',
                            mode === 'signup' ? 'flex' : 'hidden',
                            panelTransition,
                            mode === 'login' && 'md:translate-x-20 md:opacity-0 md:blur-md'
                        )}
                    >
                        <h1 className="text-xl font-semibold text-ink-primary">Create your vault</h1>
                        <p className="mt-1.5 text-sm text-ink-secondary">
                            Choose your master password carefully — it encrypts everything and can't be recovered if
                            lost.
                        </p>

                        <form onSubmit={handleSignupSubmit} className="mt-6 space-y-5" noValidate>
                            <Input
                                id="signup-email"
                                ref={signupEmailRef}
                                type="email"
                                label="Email"
                                required
                                autoComplete="email"
                                disabled={signupSubmitting}
                                leftIcon={<Mail size={16} aria-hidden="true" />}
                                value={signupEmail}
                                onChange={(e) => setSignupEmail(e.target.value)}
                            />

                            <div>
                                <Input
                                    id="signup-password"
                                    type="password"
                                    label="Master password"
                                    required
                                    minLength={10}
                                    autoComplete="new-password"
                                    disabled={signupSubmitting}
                                    hint="At least 10 characters."
                                    leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                    value={signupPassword}
                                    onChange={(e) => setSignupPassword(e.target.value)}
                                />
                                <div className="mt-2">
                                    <PasswordStrengthMeter password={signupPassword} context={[signupEmail]} />
                                </div>
                            </div>

                            <Input
                                id="signup-confirm-password"
                                type="password"
                                label="Confirm password"
                                required
                                autoComplete="new-password"
                                disabled={signupSubmitting}
                                leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                value={signupConfirm}
                                onChange={(e) => setSignupConfirm(e.target.value)}
                                error={signupConfirm && signupConfirm !== signupPassword ? "Passwords don't match." : undefined}
                            />

                            {signupError && (
                                <div
                                    role="alert"
                                    className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                                >
                                    <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    <span>{signupError}</span>
                                </div>
                            )}

                            <Button type="submit" variant="primary" className="w-full" loading={signupSubmitting}>
                                {signupSubmitting ? SIGNUP_PHASE_LABEL[signupPhase] : 'Create account'}
                            </Button>
                            {signupPhase === 'deriving' && (
                                <p className="text-center font-mono text-xs text-ink-tertiary" aria-live="polite">
                                    Running Argon2id locally in your browser — this takes a second.
                                </p>
                            )}
                        </form>

                        <p className="mt-6 text-center text-sm text-ink-secondary md:hidden">
                            Already have an account?{' '}
                            <button
                                type="button"
                                onClick={() => switchMode('login')}
                                className="rounded text-accent transition-colors duration-fast hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                Sign in
                            </button>
                        </p>
                    </div>

                    {/* Sliding gradient CTA - desktop only; mirrors the mobile toggle links above.
                        This box is half the card's width, resting over the right slot by
                        default; "signup" mode slides it left by 100% of ITS OWN width (i.e.
                        one card-half), landing it over the left slot instead. The clip-path
                        values are relative to this half-width box, not the full card - that's
                        what keeps the diagonal seam a subtle accent at the boundary between
                        the two form panels, rather than swallowing an entire form's controls. */}
                    <div
                        className={cn(
                            'absolute inset-y-0 left-0 hidden w-1/2 md:block',
                            'transition-[transform,clip-path] duration-[900ms] ease-[cubic-bezier(0.77,0,0.18,1)] motion-reduce:transition-none',
                            mode === 'signup'
                                ? 'translate-x-0 [clip-path:polygon(0_0,86%_0,100%_100%,0_100%)]'
                                : 'translate-x-full [clip-path:polygon(14%_0,100%_0,100%_100%,0_100%)]'
                        )}
                    >
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-600 via-fuchsia-600 to-pink-500 px-10 text-center">
                            <div className="max-w-xs">
                                {mode === 'login' ? (
                                    <>
                                        <h2 className="text-2xl font-semibold text-white">New around here?</h2>
                                        <p className="mt-2 text-sm text-white/85">
                                            Create an account — it only takes a few seconds.
                                        </p>
                                        <button
                                            type="button"
                                            data-testid="auth-switch-mode"
                                            onClick={() => switchMode('signup')}
                                            className="mt-6 rounded-full border-2 border-white px-6 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-white hover:text-fuchsia-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fuchsia-600"
                                        >
                                            Create account
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <h2 className="text-2xl font-semibold text-white">Already a member?</h2>
                                        <p className="mt-2 text-sm text-white/85">
                                            Sign back in and pick up where you left off.
                                        </p>
                                        <button
                                            type="button"
                                            data-testid="auth-switch-mode"
                                            onClick={() => switchMode('login')}
                                            className="mt-6 rounded-full border-2 border-white px-6 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-white hover:text-fuchsia-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fuchsia-600"
                                        >
                                            Sign in
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <p className="mt-8 flex items-center justify-center gap-1.5 font-mono text-xs text-ink-tertiary">
                    <Lock size={12} aria-hidden="true" />
                    AES-256-GCM · Argon2id · Zero-knowledge design
                </p>
                <p className="mt-3 flex items-center justify-center gap-3 text-xs text-ink-tertiary">
                    <Link
                        to="/privacy"
                        className="rounded transition-colors duration-fast hover:text-ink-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        Privacy Policy
                    </Link>
                    <span aria-hidden="true">·</span>
                    <Link
                        to="/cookies"
                        className="rounded transition-colors duration-fast hover:text-ink-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        Cookie Policy
                    </Link>
                </p>
            </div>
        </div>
    );
}
