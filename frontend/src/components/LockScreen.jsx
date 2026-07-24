import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, KeyRound, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useVaultLock } from '../context/VaultLockContext.jsx';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';
import Panel from './ui/Panel.jsx';

const PHASE_LABEL = {
    deriving: 'Deriving key…',
    verifying: 'Unlocking…',
};

export default function LockScreen() {
    const { user, logout } = useAuth();
    const { unlock } = useVaultLock();
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [phase, setPhase] = useState(null); // null | 'deriving' | 'verifying'

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        try {
            await unlock(password, setPhase);
        } catch (err) {
            setError(err.message);
        } finally {
            setPhase(null);
            setPassword('');
        }
    }

    const submitting = phase !== null;

    async function handleLogout() {
        await logout().catch(() => {});
        navigate('/login');
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lock-screen-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-surface/90 p-4 backdrop-blur-md"
        >
            <div className="w-full max-w-sm">
                <div className="mb-8 flex flex-col items-center text-center">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-warning/30 bg-warning/10">
                        <Lock className="h-5 w-5 text-warning" aria-hidden="true" />
                    </div>
                    <h1 id="lock-screen-title" className="text-xl font-semibold text-ink-primary">
                        Vault locked
                    </h1>
                    <p className="mt-1.5 text-sm text-ink-secondary">
                        Your encryption key isn't held anywhere but this browser's memory, and doesn't
                        survive a lock, a reload, or this tab closing. Enter your master password to
                        derive it again.
                    </p>
                </div>

                <Panel padding="lg">
                    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                        <Input
                            id="unlock-password"
                            type="password"
                            label={`Master password for ${user?.email ?? ''}`}
                            required
                            autoComplete="current-password"
                            autoFocus
                            disabled={submitting}
                            leftIcon={<KeyRound size={16} aria-hidden="true" />}
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
                            {submitting ? PHASE_LABEL[phase] : 'Unlock'}
                        </Button>
                        {phase === 'deriving' && (
                            <p className="text-center font-mono text-xs text-ink-tertiary" aria-live="polite">
                                Running Argon2id locally in your browser — this takes a second.
                            </p>
                        )}
                    </form>
                </Panel>

                <button
                    type="button"
                    onClick={handleLogout}
                    className="mt-6 w-full rounded text-center text-sm text-ink-secondary transition-colors duration-fast hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    Not you? Log out
                </button>
            </div>
        </div>
    );
}
