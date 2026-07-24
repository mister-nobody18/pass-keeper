import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Panel from '../components/ui/Panel.jsx';

const PHASE_LABEL = {
    deriving: 'Deriving key…',
    verifying: 'Signing in…',
};

export default function Login() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [phase, setPhase] = useState(null); // null | 'deriving' | 'verifying'

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        try {
            await login(email, password, setPhase);
            navigate('/');
        } catch (err) {
            setError(err.message);
        } finally {
            setPhase(null);
            // Argon2id + HKDF have already consumed the password by this point
            // (see crypto/kdfClient.js) - clear it from this component's state
            // either way rather than let a typed master password linger.
            setPassword('');
        }
    }

    const submitting = phase !== null;

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
                    <h1 className="text-xl font-semibold text-ink-primary">Sign in to your vault</h1>
                    <p className="mt-1.5 text-sm text-ink-secondary">
                        Encrypted end-to-end with your master password.
                    </p>
                </div>

                <Panel padding="lg">
                    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                        <Input
                            id="email"
                            type="email"
                            label="Email"
                            required
                            autoComplete="email"
                            autoFocus
                            disabled={submitting}
                            leftIcon={<Mail size={16} aria-hidden="true" />}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />

                        <Input
                            id="password"
                            type={showPassword ? 'text' : 'password'}
                            label="Master password"
                            required
                            autoComplete="current-password"
                            disabled={submitting}
                            leftIcon={<KeyRound size={16} aria-hidden="true" />}
                            rightSlot={
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    aria-pressed={showPassword}
                                    className="rounded p-1 text-ink-tertiary transition-colors duration-fast hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                    {showPassword ? (
                                        <EyeOff size={16} aria-hidden="true" />
                                    ) : (
                                        <Eye size={16} aria-hidden="true" />
                                    )}
                                </button>
                            }
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />

                        {error && (
                            <div
                                role="alert"
                                className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                            >
                                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                <span>{error}</span>
                            </div>
                        )}

                        <Button type="submit" variant="primary" className="w-full" loading={submitting}>
                            {submitting ? PHASE_LABEL[phase] : 'Sign in'}
                        </Button>
                        {phase === 'deriving' && (
                            <p className="text-center font-mono text-xs text-ink-tertiary" aria-live="polite">
                                Running Argon2id locally in your browser — this takes a second.
                            </p>
                        )}
                    </form>
                </Panel>

                <p className="mt-6 text-center text-sm text-ink-secondary">
                    Don't have an account?{' '}
                    <Link
                        to="/register"
                        className="rounded text-accent transition-colors duration-fast hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        Create one
                    </Link>
                </p>

                <p className="mt-8 flex items-center justify-center gap-1.5 font-mono text-xs text-ink-tertiary">
                    <Lock size={12} aria-hidden="true" />
                    AES-256-GCM · Argon2id · Zero-knowledge design
                </p>
            </div>
        </div>
    );
}
