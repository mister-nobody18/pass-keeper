import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Panel from '../components/ui/Panel.jsx';
import PasswordStrengthMeter from '../components/ui/PasswordStrengthMeter.jsx';

const PHASE_LABEL = {
    deriving: 'Deriving key…',
    creating: 'Creating account…',
};

export default function Register() {
    const { register } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [phase, setPhase] = useState(null); // null | 'deriving' | 'creating'

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');

        if (password.length < 10) {
            setError('Master password must be at least 10 characters.');
            return;
        }
        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        try {
            await register(email, password, setPhase);
            navigate('/');
        } catch (err) {
            setError(err.message);
        } finally {
            setPhase(null);
            setPassword('');
            setConfirmPassword('');
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
                    <h1 className="text-xl font-semibold text-ink-primary">Create your vault</h1>
                    <p className="mt-1.5 text-sm text-ink-secondary">
                        Choose your master password carefully — it encrypts everything and can't be recovered if lost.
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

                        <div>
                            <Input
                                id="password"
                                type="password"
                                label="Master password"
                                required
                                minLength={10}
                                autoComplete="new-password"
                                disabled={submitting}
                                hint="At least 10 characters."
                                leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <div className="mt-2">
                                <PasswordStrengthMeter password={password} context={[email]} />
                            </div>
                        </div>

                        <Input
                            id="confirmPassword"
                            type="password"
                            label="Confirm password"
                            required
                            autoComplete="new-password"
                            disabled={submitting}
                            leftIcon={<KeyRound size={16} aria-hidden="true" />}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            error={confirmPassword && confirmPassword !== password ? "Passwords don't match." : undefined}
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
                            {submitting ? PHASE_LABEL[phase] : 'Create account'}
                        </Button>
                        {phase === 'deriving' && (
                            <p className="text-center font-mono text-xs text-ink-tertiary" aria-live="polite">
                                Running Argon2id locally in your browser — this takes a second.
                            </p>
                        )}
                    </form>
                </Panel>

                <p className="mt-6 text-center text-sm text-ink-secondary">
                    Already have an account?{' '}
                    <Link
                        to="/login"
                        className="rounded text-accent transition-colors duration-fast hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    );
}
