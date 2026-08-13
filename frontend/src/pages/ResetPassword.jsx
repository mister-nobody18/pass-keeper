import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, AlertTriangle, KeyRound, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { deriveKeys, generateKdfSalt, DEFAULT_KDF_PARAMS } from '../crypto/kdfClient.js';
import { generateDek, wrapDek, unwrapDek, unwrapDekForRewrap, DekUnwrapError } from '../crypto/dek.js';
import { generateRecoveryKey, deriveRecoveryWrapKey, parseRecoveryKey } from '../crypto/recoveryKey.js';
import { encryptVault } from '../crypto/vaultCipher.js';
import { setVaultKey } from '../crypto/vaultKeyStore.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Panel from '../components/ui/Panel.jsx';
import PasswordStrengthMeter from '../components/ui/PasswordStrengthMeter.jsx';
import RecoveryKeyDisplay from '../components/RecoveryKeyDisplay.jsx';

const RECOVERY_PHASE_LABEL = {
    unwrapping: 'Unwrapping your vault key…',
    deriving: 'Deriving new key…',
    saving: 'Saving…',
};

const DESTRUCTIVE_PHASE_LABEL = {
    deriving: 'Deriving new key…',
    saving: 'Saving…',
};

export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') ?? '';
    const navigate = useNavigate();
    const { setUser } = useAuth();

    const [verifyState, setVerifyState] = useState('loading'); // loading | invalid | ready
    const [tokenInfo, setTokenInfo] = useState(null); // { email, wrappedDekRecovery }
    const [mode, setMode] = useState('recovery'); // 'recovery' | 'destructive'

    // recovery-path form
    const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [recoveryError, setRecoveryError] = useState('');
    const [recoveryPhase, setRecoveryPhase] = useState(null);

    // destructive-path form
    const [destructivePassword, setDestructivePassword] = useState('');
    const [destructiveConfirm, setDestructiveConfirm] = useState('');
    const [destructiveAck, setDestructiveAck] = useState(false);
    const [destructiveError, setDestructiveError] = useState('');
    const [destructivePhase, setDestructivePhase] = useState(null);
    const [freshRecoveryKey, setFreshRecoveryKey] = useState(null);
    const [pendingUser, setPendingUser] = useState(null);

    // 2FA challenge - a completed reset still isn't enough to finish
    // logging in if the account has 2FA enabled (see docs/THREAT-MODEL.md:
    // otherwise 2FA gives no protection against an attacker who's
    // compromised the account's email). Holds whatever each path needs to
    // actually finish once the code is verified.
    const [twoFactorPending, setTwoFactorPending] = useState(null); // { mode, newWrapKey, dek, formattedRecoveryKey } | null
    const [twoFactorCode, setTwoFactorCode] = useState('');
    const [rememberDevice, setRememberDevice] = useState(false);
    const [twoFactorError, setTwoFactorError] = useState('');
    const [twoFactorPhase, setTwoFactorPhase] = useState(null);

    useEffect(() => {
        if (!token) {
            setVerifyState('invalid');
            return;
        }
        api.verifyPasswordResetToken(token)
            .then((data) => {
                if (!data.valid) {
                    setVerifyState('invalid');
                    return;
                }
                setTokenInfo({ email: data.email, wrappedDekRecovery: data.wrappedDekRecovery });
                setMode(data.wrappedDekRecovery ? 'recovery' : 'destructive');
                setVerifyState('ready');
            })
            .catch(() => setVerifyState('invalid'));
    }, [token]);

    async function handleRecoverySubmit(e) {
        e.preventDefault();
        setRecoveryError('');

        if (newPassword.length < 10) {
            setRecoveryError('New password must be at least 10 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setRecoveryError('Passwords do not match.');
            return;
        }

        try {
            setRecoveryPhase('unwrapping');
            let rawKey;
            try {
                rawKey = parseRecoveryKey(recoveryKeyInput);
            } catch (err) {
                throw new Error(err.message);
            }
            const recoveryWrapKey = await deriveRecoveryWrapKey(rawKey);
            let dekForRewrap;
            try {
                dekForRewrap = await unwrapDekForRewrap(tokenInfo.wrappedDekRecovery, recoveryWrapKey);
            } catch (err) {
                if (err instanceof DekUnwrapError) {
                    throw new Error('That recovery key is incorrect.');
                }
                throw err;
            }

            setRecoveryPhase('deriving');
            const newSalt = generateKdfSalt();
            const { authHash: newAuthHash, encryptionKey: newWrapKey } = await deriveKeys(
                newPassword,
                newSalt,
                DEFAULT_KDF_PARAMS
            );
            const newWrappedDekPassword = await wrapDek(dekForRewrap, newWrapKey);

            setRecoveryPhase('saving');
            const data = await api.confirmPasswordReset({
                token,
                newAuthHash,
                newKdfSalt: newSalt,
                newKdfParams: JSON.stringify(DEFAULT_KDF_PARAMS),
                newWrappedDekPassword,
                mode: 'recovery',
            });

            if (data.twoFactorRequired) {
                setTwoFactorPending({ mode: 'recovery', newWrapKey });
                return;
            }

            const dek = await unwrapDek(data.wrappedDekPassword, newWrapKey);
            setVaultKey(dek);
            setUser(data.user);
            navigate('/');
        } catch (err) {
            setRecoveryError(err.message);
        } finally {
            setRecoveryPhase(null);
        }
    }

    async function handleDestructiveSubmit(e) {
        e.preventDefault();
        setDestructiveError('');

        if (destructivePassword.length < 10) {
            setDestructiveError('New password must be at least 10 characters.');
            return;
        }
        if (destructivePassword !== destructiveConfirm) {
            setDestructiveError('Passwords do not match.');
            return;
        }
        if (!destructiveAck) {
            setDestructiveError('Confirm you understand your existing vault data will be lost.');
            return;
        }

        try {
            setDestructivePhase('deriving');
            const newSalt = generateKdfSalt();
            const { authHash: newAuthHash, encryptionKey: newWrapKey } = await deriveKeys(
                destructivePassword,
                newSalt,
                DEFAULT_KDF_PARAMS
            );

            // Brand new DEK, brand new empty vault - there is nothing to
            // recover without the old recovery key (see dek.js/ARCHITECTURE.md).
            const extractableDek = await generateDek();
            const newWrappedDekPassword = await wrapDek(extractableDek, newWrapKey);

            const { raw, formatted } = generateRecoveryKey();
            const recoveryWrapKey = await deriveRecoveryWrapKey(raw);
            const newWrappedDekRecovery = await wrapDek(extractableDek, recoveryWrapKey);

            const dek = await unwrapDek(newWrappedDekPassword, newWrapKey);
            const newVaultCiphertext = await encryptVault([], dek);

            setDestructivePhase('saving');
            const data = await api.confirmPasswordReset({
                token,
                newAuthHash,
                newKdfSalt: newSalt,
                newKdfParams: JSON.stringify(DEFAULT_KDF_PARAMS),
                newWrappedDekPassword,
                mode: 'destructive',
                newWrappedDekRecovery,
                newVaultCiphertext,
            });

            if (data.twoFactorRequired) {
                // The DEK itself is already known locally (it had to be, to
                // encrypt the fresh empty vault above) - 2FA here only
                // gates finishing the LOGIN, not anything about the reset
                // that already committed server-side.
                setTwoFactorPending({ mode: 'destructive', dek, formattedRecoveryKey: formatted });
                return;
            }

            setVaultKey(dek);
            setPendingUser(data.user);
            setFreshRecoveryKey(formatted);
        } catch (err) {
            setDestructiveError(err.message);
        } finally {
            setDestructivePhase(null);
        }
    }

    async function handleTwoFactorSubmit(e) {
        e.preventDefault();
        setTwoFactorError('');
        setTwoFactorPhase('verifying');
        try {
            const data = await api.totpVerify({ code: twoFactorCode, rememberDevice });

            if (twoFactorPending.mode === 'recovery') {
                const dek = await unwrapDek(data.wrappedDekPassword, twoFactorPending.newWrapKey);
                setVaultKey(dek);
                setUser(data.user);
                navigate('/');
            } else {
                setVaultKey(twoFactorPending.dek);
                setPendingUser(data.user);
                setFreshRecoveryKey(twoFactorPending.formattedRecoveryKey);
            }
        } catch (err) {
            setTwoFactorError(err.message);
            setTwoFactorCode('');
        } finally {
            setTwoFactorPhase(null);
        }
    }

    const recoverySubmitting = recoveryPhase !== null;
    const destructiveSubmitting = destructivePhase !== null;
    const twoFactorSubmitting = twoFactorPhase !== null;

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
                            Enter the 6-digit code from your authenticator app to finish resetting your password.
                        </p>
                    </div>

                    <Panel padding="lg">
                        <form onSubmit={handleTwoFactorSubmit} className="space-y-4" noValidate>
                            <Input
                                id="reset-totp-code"
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
                                {twoFactorSubmitting ? 'Verifying…' : 'Verify'}
                            </Button>
                        </form>
                    </Panel>
                </div>
            </div>
        );
    }

    if (freshRecoveryKey) {
        return (
            <div className="flex min-h-screen items-center justify-center p-4">
                <div className="w-full max-w-sm">
                    <div className="mb-8 flex flex-col items-center text-center">
                        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
                            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
                        </div>
                        <h1 className="text-xl font-semibold text-ink-primary">Password reset</h1>
                        <p className="mt-1.5 text-sm text-ink-secondary">
                            Your vault has been reset with a fresh, empty vault. Save this new recovery key so you
                            don't lose access again.
                        </p>
                    </div>
                    <RecoveryKeyDisplay
                        recoveryKey={freshRecoveryKey}
                        onContinue={() => {
                            setUser(pendingUser);
                            navigate('/');
                        }}
                        continueLabel="Go to my vault"
                    />
                </div>
            </div>
        );
    }

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
                    <h1 className="text-xl font-semibold text-ink-primary">Reset your password</h1>
                </div>

                {verifyState === 'loading' && (
                    <Panel padding="lg" className="flex items-center justify-center gap-2 py-10 text-sm text-ink-secondary">
                        <Loader2 className="animate-spin" size={16} aria-hidden="true" />
                        Checking your reset link…
                    </Panel>
                )}

                {verifyState === 'invalid' && (
                    <Panel padding="lg">
                        <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
                            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                            <span>This reset link is invalid, expired, or already used.</span>
                        </div>
                        <Link
                            to="/forgot-password"
                            className="mt-4 inline-block rounded text-sm text-accent transition-colors duration-fast hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            Request a new link
                        </Link>
                    </Panel>
                )}

                {verifyState === 'ready' && (
                    <Panel padding="lg">
                        {tokenInfo.wrappedDekRecovery && (
                            <div className="mb-5 flex gap-1 rounded-md border border-line bg-surface p-1">
                                <button
                                    type="button"
                                    onClick={() => setMode('recovery')}
                                    aria-pressed={mode === 'recovery'}
                                    className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                                        mode === 'recovery'
                                            ? 'bg-accent text-accent-on'
                                            : 'text-ink-secondary hover:text-ink-primary'
                                    }`}
                                >
                                    I have my recovery key
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMode('destructive')}
                                    aria-pressed={mode === 'destructive'}
                                    className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                                        mode === 'destructive'
                                            ? 'bg-accent text-accent-on'
                                            : 'text-ink-secondary hover:text-ink-primary'
                                    }`}
                                >
                                    Start fresh instead
                                </button>
                            </div>
                        )}

                        {mode === 'recovery' && tokenInfo.wrappedDekRecovery ? (
                            <form onSubmit={handleRecoverySubmit} className="space-y-4" noValidate>
                                <p className="text-sm text-ink-secondary">
                                    Enter the recovery key you saved for <span className="font-mono">{tokenInfo.email}</span>{' '}
                                    to keep your existing vault data.
                                </p>
                                <Input
                                    id="recovery-key"
                                    type="text"
                                    label="Recovery key"
                                    required
                                    autoFocus
                                    disabled={recoverySubmitting}
                                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                                    className="font-mono"
                                    leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                    value={recoveryKeyInput}
                                    onChange={(e) => setRecoveryKeyInput(e.target.value)}
                                />
                                <div>
                                    <Input
                                        id="new-password"
                                        type="password"
                                        label="New master password"
                                        required
                                        minLength={10}
                                        autoComplete="new-password"
                                        disabled={recoverySubmitting}
                                        leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                    />
                                    <div className="mt-2">
                                        <PasswordStrengthMeter password={newPassword} context={[tokenInfo.email]} />
                                    </div>
                                </div>
                                <Input
                                    id="confirm-password"
                                    type="password"
                                    label="Confirm new password"
                                    required
                                    autoComplete="new-password"
                                    disabled={recoverySubmitting}
                                    leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    error={confirmPassword && confirmPassword !== newPassword ? "Passwords don't match." : undefined}
                                />

                                {recoveryError && (
                                    <div
                                        role="alert"
                                        className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                                    >
                                        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                        <span>{recoveryError}</span>
                                    </div>
                                )}

                                <Button type="submit" variant="primary" className="w-full" loading={recoverySubmitting}>
                                    {recoverySubmitting ? RECOVERY_PHASE_LABEL[recoveryPhase] : 'Reset password'}
                                </Button>
                            </form>
                        ) : (
                            <form onSubmit={handleDestructiveSubmit} className="space-y-4" noValidate>
                                <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
                                    <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    <span>
                                        {tokenInfo.wrappedDekRecovery
                                            ? "Without your recovery key, we can't decrypt your existing vault. This starts a brand new, empty one."
                                            : "No recovery key was ever set up for this account, so your existing vault can't be recovered. This starts a brand new, empty one."}
                                    </span>
                                </div>

                                <div>
                                    <Input
                                        id="destructive-new-password"
                                        type="password"
                                        label="New master password"
                                        required
                                        minLength={10}
                                        autoComplete="new-password"
                                        disabled={destructiveSubmitting}
                                        leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                        value={destructivePassword}
                                        onChange={(e) => setDestructivePassword(e.target.value)}
                                    />
                                    <div className="mt-2">
                                        <PasswordStrengthMeter password={destructivePassword} context={[tokenInfo.email]} />
                                    </div>
                                </div>
                                <Input
                                    id="destructive-confirm-password"
                                    type="password"
                                    label="Confirm new password"
                                    required
                                    autoComplete="new-password"
                                    disabled={destructiveSubmitting}
                                    leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                    value={destructiveConfirm}
                                    onChange={(e) => setDestructiveConfirm(e.target.value)}
                                    error={
                                        destructiveConfirm && destructiveConfirm !== destructivePassword
                                            ? "Passwords don't match."
                                            : undefined
                                    }
                                />

                                <label className="flex items-start gap-2.5 text-sm text-ink-secondary">
                                    <input
                                        type="checkbox"
                                        checked={destructiveAck}
                                        onChange={(e) => setDestructiveAck(e.target.checked)}
                                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line bg-surface text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    />
                                    <span className="flex items-start gap-1.5">
                                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                                        I understand my existing vault entries will be permanently lost.
                                    </span>
                                </label>

                                {destructiveError && (
                                    <div
                                        role="alert"
                                        className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                                    >
                                        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                        <span>{destructiveError}</span>
                                    </div>
                                )}

                                <Button
                                    type="submit"
                                    variant="danger"
                                    className="w-full"
                                    loading={destructiveSubmitting}
                                    disabled={!destructiveAck}
                                >
                                    {destructiveSubmitting ? DESTRUCTIVE_PHASE_LABEL[destructivePhase] : 'Reset and start fresh'}
                                </Button>
                            </form>
                        )}
                    </Panel>
                )}

                <p className="mt-6 text-center text-sm text-ink-secondary">
                    <Link
                        to="/login"
                        className="rounded text-accent transition-colors duration-fast hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        Back to sign in
                    </Link>
                </p>
            </div>
        </div>
    );
}
