import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    AlertCircle,
    AlertTriangle,
    ArrowLeft,
    CheckCircle2,
    Download,
    KeyRound,
    RefreshCw,
    ShieldCheck,
    ShieldQuestion,
    Trash2,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useVaultLock } from '../context/VaultLockContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { deriveKeys, generateKdfSalt, DEFAULT_KDF_PARAMS } from '../crypto/kdfClient.js';
import { wrapDek, unwrapDekForRewrap, DekUnwrapError } from '../crypto/dek.js';
import { generateRecoveryKey, deriveRecoveryWrapKey } from '../crypto/recoveryKey.js';
import { decryptVault } from '../crypto/vaultCipher.js';
import { setVaultKey, clearVaultKey, getVaultKey } from '../crypto/vaultKeyStore.js';
import TopBar from '../components/TopBar.jsx';
import Panel from '../components/ui/Panel.jsx';
import Input from '../components/ui/Input.jsx';
import Button from '../components/ui/Button.jsx';
import PasswordStrengthMeter from '../components/ui/PasswordStrengthMeter.jsx';
import RecoveryKeyDisplay from '../components/RecoveryKeyDisplay.jsx';
import TwoFactorSetup from '../components/TwoFactorSetup.jsx';

const PHASE_LABEL = {
    'deriving-current': 'Deriving current key…',
    'unwrapping': 'Verifying current password…',
    'deriving-new': 'Deriving new key…',
    'saving': 'Saving…',
};

export default function Settings() {
    const { user, setUser } = useAuth();
    const { extend } = useVaultLock();
    const { showToast } = useToast();
    const navigate = useNavigate();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [phase, setPhase] = useState(null);

    const [recoveryKeyCreatedAt, setRecoveryKeyCreatedAt] = useState(user?.recoveryKeyCreatedAt ?? null);
    const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);
    const [recoveryPassword, setRecoveryPassword] = useState('');
    const [recoveryError, setRecoveryError] = useState('');
    const [recoveryPhase, setRecoveryPhase] = useState(null);
    const [newRecoveryKey, setNewRecoveryKey] = useState(null);

    // --- Two-factor authentication ---
    const [totpEnabled, setTotpEnabled] = useState(user?.totpEnabled ?? false);
    const [showTotpSetup, setShowTotpSetup] = useState(false);

    const [showDisableTotpPrompt, setShowDisableTotpPrompt] = useState(false);
    const [disableTotpPassword, setDisableTotpPassword] = useState('');
    const [disableTotpError, setDisableTotpError] = useState('');
    const [disableTotpSubmitting, setDisableTotpSubmitting] = useState(false);

    const [showForgetDevicesPrompt, setShowForgetDevicesPrompt] = useState(false);
    const [forgetDevicesPassword, setForgetDevicesPassword] = useState('');
    const [forgetDevicesError, setForgetDevicesError] = useState('');
    const [forgetDevicesSubmitting, setForgetDevicesSubmitting] = useState(false);

    // --- Data export ---
    const [exportError, setExportError] = useState('');
    const [exportSubmitting, setExportSubmitting] = useState(false);

    // --- Delete account ---
    const [showDeletePrompt, setShowDeletePrompt] = useState(false);
    const [deletePassword, setDeletePassword] = useState('');
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [deleteError, setDeleteError] = useState('');
    const [deleteSubmitting, setDeleteSubmitting] = useState(false);

    // Shared by the disable-2FA/forget-devices/delete-account re-auth
    // prompts below - none of them need the vault's DEK, only proof the
    // current password is correct, so this is simpler than the recovery-key
    // section's flow above (which also needs to unwrap/re-wrap the DEK).
    async function deriveCurrentAuthHash(password) {
        const { kdfSalt, kdfParams } = await api.getLoginSalt(user.email);
        const { authHash } = await deriveKeys(password, kdfSalt, JSON.parse(kdfParams));
        return authHash;
    }

    async function handleChangePassword(e) {
        e.preventDefault();
        setError('');
        setSuccess(false);

        if (newPassword.length < 10) {
            setError('New password must be at least 10 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('New passwords do not match.');
            return;
        }

        try {
            // 1. Re-derive the CURRENT wrap key from the typed current password,
            //    using this account's existing (possibly older, lower-cost)
            //    stored params.
            setPhase('deriving-current');
            const { kdfSalt: currentSalt, kdfParams: currentParamsJson } = await api.getLoginSalt(user.email);
            const { authHash: currentAuthHash, encryptionKey: currentWrapKey } = await deriveKeys(
                currentPassword,
                currentSalt,
                JSON.parse(currentParamsJson)
            );

            // 2. Prove that key is actually correct by unwrapping the real DEK
            //    with it - not just trusting the typed password. A wrong
            //    current password fails right here, locally, as a normal
            //    unwrap failure (see crypto/dek.js), before any request that
            //    would touch the server's rate limit for this account. Uses
            //    the "for rewrap" variant since we need an extractable copy
            //    to wrap again under the new key below.
            setPhase('unwrapping');
            const { wrappedDekPassword } = await api.me();
            let dekForRewrap;
            try {
                dekForRewrap = await unwrapDekForRewrap(wrappedDekPassword, currentWrapKey);
            } catch (err) {
                if (err instanceof DekUnwrapError) {
                    throw new Error('Current password is incorrect.');
                }
                throw err;
            }

            // 3. Derive a FRESH wrap key from the new password, with a fresh
            //    salt and the current DEFAULT_KDF_PARAMS, and re-wrap the SAME
            //    DEK under it. The vault ciphertext itself never moves.
            setPhase('deriving-new');
            const newSalt = generateKdfSalt();
            const { authHash: newAuthHash, encryptionKey: newWrapKey } = await deriveKeys(
                newPassword,
                newSalt,
                DEFAULT_KDF_PARAMS
            );
            const newWrappedDekPassword = await wrapDek(dekForRewrap, newWrapKey);

            // 4. Server commits the new auth hash + wrap in one statement -
            //    see backend-php/public_html/api/change_password.php.
            setPhase('saving');
            try {
                await api.changePassword({
                    currentAuthHash,
                    newAuthHash,
                    newKdfSalt: newSalt,
                    newKdfParams: JSON.stringify(DEFAULT_KDF_PARAMS),
                    newWrappedDekPassword,
                });
            } catch (err) {
                if (err.isNetworkError) {
                    // The request may have reached the server and committed
                    // before the connection dropped - the server statement
                    // is atomic (see change_password.php), but from here we
                    // genuinely can't tell whether it ran. Don't imply
                    // "nothing happened": that would send the user back to
                    // retrying with their OLD password, which would then be
                    // rejected (confusingly, as "incorrect") if the change
                    // actually did go through the first time.
                    throw new Error(
                        "Lost connection while saving. We can't confirm whether your password was changed — " +
                            'try signing in with your NEW password before retrying with the old one.'
                    );
                }
                throw err;
            }

            const workingDek = await unwrapDekForRewrap(newWrappedDekPassword, newWrapKey);
            setVaultKey(workingDek);
            setSuccess(true);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            extend(); // password change issues a fresh server session; reset the idle lock to match
            showToast({ tone: 'success', message: 'Master password updated.' });
        } catch (err) {
            setError(err.message);
        } finally {
            setPhase(null);
        }
    }

    async function handleGenerateRecoveryKey(e) {
        e.preventDefault();
        setRecoveryError('');

        try {
            setRecoveryPhase('deriving');
            const { kdfSalt, kdfParams } = await api.getLoginSalt(user.email);
            const { authHash, encryptionKey: passwordWrapKey } = await deriveKeys(
                recoveryPassword,
                kdfSalt,
                JSON.parse(kdfParams)
            );

            setRecoveryPhase('verifying');
            const { wrappedDekPassword } = await api.me();
            let dekForRewrap;
            try {
                dekForRewrap = await unwrapDekForRewrap(wrappedDekPassword, passwordWrapKey);
            } catch (err) {
                if (err instanceof DekUnwrapError) {
                    throw new Error('Current password is incorrect.');
                }
                throw err;
            }

            setRecoveryPhase('generating');
            const { raw, formatted } = generateRecoveryKey();
            const recoveryWrapKey = await deriveRecoveryWrapKey(raw);
            const wrappedDekRecovery = await wrapDek(dekForRewrap, recoveryWrapKey);

            setRecoveryPhase('saving');
            const { recoveryKeyCreatedAt: createdAt } = await api.updateRecoveryKey({
                currentAuthHash: authHash,
                newWrappedDekRecovery: wrappedDekRecovery,
            });

            setRecoveryKeyCreatedAt(createdAt);
            setNewRecoveryKey(formatted);
            setShowRecoveryPrompt(false);
            setRecoveryPassword('');
        } catch (err) {
            setRecoveryError(err.message);
        } finally {
            setRecoveryPhase(null);
        }
    }

    async function handleDisableTotp(e) {
        e.preventDefault();
        setDisableTotpError('');
        setDisableTotpSubmitting(true);
        try {
            const authHash = await deriveCurrentAuthHash(disableTotpPassword);
            await api.totpDisable(authHash);
            setTotpEnabled(false);
            setShowDisableTotpPrompt(false);
            setDisableTotpPassword('');
            showToast({ tone: 'success', message: 'Two-factor authentication disabled.' });
        } catch (err) {
            setDisableTotpError(err.message);
        } finally {
            setDisableTotpSubmitting(false);
        }
    }

    async function handleForgetDevices(e) {
        e.preventDefault();
        setForgetDevicesError('');
        setForgetDevicesSubmitting(true);
        try {
            const authHash = await deriveCurrentAuthHash(forgetDevicesPassword);
            const { forgotten } = await api.forgetDevices(authHash);
            setShowForgetDevicesPrompt(false);
            setForgetDevicesPassword('');
            showToast({
                tone: 'success',
                message: forgotten > 0 ? `Forgot ${forgotten} remembered device${forgotten === 1 ? '' : 's'}.` : 'No remembered devices to forget.',
            });
        } catch (err) {
            setForgetDevicesError(err.message);
        } finally {
            setForgetDevicesSubmitting(false);
        }
    }

    async function handleExportData(e) {
        e.preventDefault();
        setExportError('');
        setExportSubmitting(true);
        try {
            const { ciphertext } = await api.getVault();
            const entries = await decryptVault(ciphertext, getVaultKey());

            // Deliberately client-side only - the server holds nothing but
            // opaque ciphertext, so a server-side "export" could only ever
            // hand back the same encrypted blob, not something readable.
            // This combines the account metadata already visible via /me.php
            // with the vault entries already decrypted in this tab's memory.
            const exportPayload = {
                exportedAt: new Date().toISOString(),
                account: {
                    email: user.email,
                    recoveryKeyCreatedAt: user.recoveryKeyCreatedAt ?? recoveryKeyCreatedAt,
                    twoFactorEnabled: totpEnabled,
                },
                vaultEntries: entries,
            };

            const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pass-keeper-export.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showToast({ tone: 'success', message: 'Data exported.' });
        } catch (err) {
            setExportError(err.message);
        } finally {
            setExportSubmitting(false);
        }
    }

    async function handleDeleteAccount(e) {
        e.preventDefault();
        setDeleteError('');
        if (deleteConfirmText !== 'DELETE') {
            setDeleteError('Type DELETE to confirm.');
            return;
        }
        setDeleteSubmitting(true);
        try {
            const authHash = await deriveCurrentAuthHash(deletePassword);
            await api.deleteAccount(authHash);
            clearVaultKey();
            setUser(null);
            navigate('/login');
        } catch (err) {
            setDeleteError(err.message);
            setDeleteSubmitting(false);
        }
    }

    const submitting = phase !== null;
    const recoverySubmitting = recoveryPhase !== null;
    const RECOVERY_PHASE_LABEL = {
        deriving: 'Deriving key…',
        verifying: 'Verifying current password…',
        generating: 'Generating recovery key…',
        saving: 'Saving…',
    };

    return (
        <div className="mx-auto max-w-3xl p-4 sm:p-6">
            <TopBar />

            <Link
                to="/"
                className="inline-flex items-center gap-1.5 rounded text-sm text-ink-secondary transition-colors duration-fast hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <ArrowLeft size={14} aria-hidden="true" />
                Back to vault
            </Link>

            <h2 className="mb-6 mt-4 text-xl font-semibold text-ink-primary">Account settings</h2>

            <Panel padding="lg" className="mb-6">
                <h3 className="font-medium text-ink-primary">Change master password</h3>
                <p className="mb-4 mt-1 text-sm text-ink-secondary">
                    Your vault stays intact — only how its encryption key is protected changes,
                    entirely in your browser.
                </p>

                <form onSubmit={handleChangePassword} className="max-w-sm space-y-4" noValidate>
                    <Input
                        id="current-password"
                        type="password"
                        label="Current password"
                        required
                        autoComplete="current-password"
                        disabled={submitting}
                        leftIcon={<KeyRound size={16} aria-hidden="true" />}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                    <div>
                        <Input
                            id="new-password"
                            type="password"
                            label="New password"
                            required
                            minLength={10}
                            autoComplete="new-password"
                            disabled={submitting}
                            leftIcon={<KeyRound size={16} aria-hidden="true" />}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <div className="mt-2">
                            <PasswordStrengthMeter password={newPassword} />
                        </div>
                    </div>
                    <Input
                        id="confirm-new-password"
                        type="password"
                        label="Confirm new password"
                        required
                        autoComplete="new-password"
                        disabled={submitting}
                        leftIcon={<KeyRound size={16} aria-hidden="true" />}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        error={confirmPassword && confirmPassword !== newPassword ? "Passwords don't match." : undefined}
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
                    {success && (
                        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
                            <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
                            <span>Master password updated.</span>
                        </div>
                    )}

                    <Button type="submit" loading={submitting}>
                        {submitting ? PHASE_LABEL[phase] : 'Update password'}
                    </Button>
                </form>
            </Panel>

            <Panel padding="lg" className="mb-6">
                {newRecoveryKey ? (
                    <RecoveryKeyDisplay
                        recoveryKey={newRecoveryKey}
                        onContinue={() => setNewRecoveryKey(null)}
                        continueLabel="Done"
                    />
                ) : (
                    <>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="font-medium text-ink-primary">Recovery key</h3>
                                <p className="mt-1 text-sm text-ink-secondary">
                                    Lets you get back into your vault if you forget your master password,
                                    without losing your data.
                                </p>
                                <p className="mt-2 text-sm">
                                    {recoveryKeyCreatedAt ? (
                                        <span className="inline-flex items-center gap-1.5 text-success">
                                            <CheckCircle2 size={14} aria-hidden="true" />
                                            Set up {new Date(recoveryKeyCreatedAt).toLocaleDateString()}
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 text-warning">
                                            <ShieldQuestion size={14} aria-hidden="true" />
                                            Not set up — a lost password would mean a fresh, empty vault.
                                        </span>
                                    )}
                                </p>
                            </div>
                            {!showRecoveryPrompt && (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    leftIcon={<RefreshCw size={14} aria-hidden="true" />}
                                    onClick={() => {
                                        setShowRecoveryPrompt(true);
                                        setRecoveryError('');
                                    }}
                                >
                                    {recoveryKeyCreatedAt ? 'Regenerate' : 'Set up'}
                                </Button>
                            )}
                        </div>

                        {showRecoveryPrompt && (
                            <form onSubmit={handleGenerateRecoveryKey} className="mt-4 max-w-sm space-y-4" noValidate>
                                <p className="text-sm text-ink-secondary">
                                    Confirm your current master password.
                                    {recoveryKeyCreatedAt && ' Your existing recovery key will stop working.'}
                                </p>
                                <Input
                                    id="recovery-current-password"
                                    type="password"
                                    label="Current password"
                                    required
                                    autoComplete="current-password"
                                    autoFocus
                                    disabled={recoverySubmitting}
                                    leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                    value={recoveryPassword}
                                    onChange={(e) => setRecoveryPassword(e.target.value)}
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

                                <div className="flex gap-2">
                                    <Button type="submit" size="sm" loading={recoverySubmitting}>
                                        {recoverySubmitting ? RECOVERY_PHASE_LABEL[recoveryPhase] : 'Generate recovery key'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={recoverySubmitting}
                                        onClick={() => {
                                            setShowRecoveryPrompt(false);
                                            setRecoveryPassword('');
                                            setRecoveryError('');
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </form>
                        )}
                    </>
                )}
            </Panel>

            <Panel padding="lg" className="mb-6">
                {showTotpSetup ? (
                    <TwoFactorSetup
                        onCancel={() => setShowTotpSetup(false)}
                        onEnabled={() => {
                            setTotpEnabled(true);
                            setShowTotpSetup(false);
                            showToast({ tone: 'success', message: 'Two-factor authentication enabled.' });
                        }}
                    />
                ) : (
                    <>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="font-medium text-ink-primary">Two-factor authentication</h3>
                                <p className="mt-1 text-sm text-ink-secondary">
                                    Require a code from an authenticator app (like Google Authenticator) to sign
                                    in, in addition to your master password.
                                </p>
                                <p className="mt-2 text-sm">
                                    {totpEnabled ? (
                                        <span className="inline-flex items-center gap-1.5 text-success">
                                            <ShieldCheck size={14} aria-hidden="true" />
                                            Enabled
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 text-ink-tertiary">
                                            <ShieldQuestion size={14} aria-hidden="true" />
                                            Not enabled
                                        </span>
                                    )}
                                </p>
                            </div>
                            {!showDisableTotpPrompt && !showForgetDevicesPrompt && (
                                <Button
                                    type="button"
                                    variant={totpEnabled ? 'danger' : 'secondary'}
                                    size="sm"
                                    onClick={() => {
                                        if (totpEnabled) {
                                            setShowDisableTotpPrompt(true);
                                            setDisableTotpError('');
                                        } else {
                                            setShowTotpSetup(true);
                                        }
                                    }}
                                >
                                    {totpEnabled ? 'Disable' : 'Enable'}
                                </Button>
                            )}
                        </div>

                        {showDisableTotpPrompt && (
                            <form onSubmit={handleDisableTotp} className="mt-4 max-w-sm space-y-4" noValidate>
                                <p className="text-sm text-ink-secondary">
                                    Confirm your current master password to disable two-factor authentication.
                                </p>
                                <Input
                                    id="disable-totp-password"
                                    type="password"
                                    label="Current password"
                                    required
                                    autoComplete="current-password"
                                    autoFocus
                                    disabled={disableTotpSubmitting}
                                    leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                    value={disableTotpPassword}
                                    onChange={(e) => setDisableTotpPassword(e.target.value)}
                                />
                                {disableTotpError && (
                                    <div
                                        role="alert"
                                        className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                                    >
                                        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                        <span>{disableTotpError}</span>
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <Button type="submit" variant="danger" size="sm" loading={disableTotpSubmitting}>
                                        {disableTotpSubmitting ? 'Disabling…' : 'Disable 2FA'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={disableTotpSubmitting}
                                        onClick={() => {
                                            setShowDisableTotpPrompt(false);
                                            setDisableTotpPassword('');
                                            setDisableTotpError('');
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </form>
                        )}

                        {totpEnabled && !showDisableTotpPrompt && (
                            <div className="mt-4 border-t border-line pt-4">
                                {!showForgetDevicesPrompt ? (
                                    <div className="flex items-center justify-between gap-4">
                                        <p className="text-sm text-ink-secondary">
                                            Devices you've marked "remember this device" skip the code for 30 days.
                                        </p>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => {
                                                setShowForgetDevicesPrompt(true);
                                                setForgetDevicesError('');
                                            }}
                                        >
                                            Sign out remembered devices
                                        </Button>
                                    </div>
                                ) : (
                                    <form onSubmit={handleForgetDevices} className="max-w-sm space-y-4" noValidate>
                                        <p className="text-sm text-ink-secondary">
                                            Confirm your current master password. Every device will need the code
                                            again next time.
                                        </p>
                                        <Input
                                            id="forget-devices-password"
                                            type="password"
                                            label="Current password"
                                            required
                                            autoComplete="current-password"
                                            autoFocus
                                            disabled={forgetDevicesSubmitting}
                                            leftIcon={<KeyRound size={16} aria-hidden="true" />}
                                            value={forgetDevicesPassword}
                                            onChange={(e) => setForgetDevicesPassword(e.target.value)}
                                        />
                                        {forgetDevicesError && (
                                            <div
                                                role="alert"
                                                className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                                            >
                                                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                                <span>{forgetDevicesError}</span>
                                            </div>
                                        )}
                                        <div className="flex gap-2">
                                            <Button type="submit" size="sm" loading={forgetDevicesSubmitting}>
                                                {forgetDevicesSubmitting ? 'Signing out…' : 'Sign out remembered devices'}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                disabled={forgetDevicesSubmitting}
                                                onClick={() => {
                                                    setShowForgetDevicesPrompt(false);
                                                    setForgetDevicesPassword('');
                                                    setForgetDevicesError('');
                                                }}
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    </form>
                                )}
                            </div>
                        )}
                    </>
                )}
            </Panel>

            <Panel padding="lg" className="mb-6">
                <h3 className="font-medium text-ink-primary">Export your data</h3>
                <p className="mt-1 text-sm text-ink-secondary">
                    Downloads your vault entries (decrypted, right here in your browser) plus your basic
                    account info as a JSON file. The server only ever holds opaque ciphertext, so this is
                    the only way to get your data in a form you can actually read — see{' '}
                    <Link
                        to="/privacy"
                        className="rounded text-accent transition-colors duration-fast hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        Privacy Policy
                    </Link>
                    .
                </p>
                {exportError && (
                    <div
                        role="alert"
                        className="mt-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                    >
                        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span>{exportError}</span>
                    </div>
                )}
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-4"
                    loading={exportSubmitting}
                    leftIcon={<Download size={14} aria-hidden="true" />}
                    onClick={handleExportData}
                >
                    {exportSubmitting ? 'Preparing export…' : 'Export my data'}
                </Button>
            </Panel>

            <Panel padding="lg">
                <h3 className="font-medium text-danger">Delete account</h3>
                <p className="mt-1 text-sm text-ink-secondary">
                    Permanently deletes your account and vault. This cannot be undone once confirmed —
                    backups roll off within 14 days, but the live copy is gone immediately.
                </p>

                {!showDeletePrompt ? (
                    <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        className="mt-4"
                        leftIcon={<Trash2 size={14} aria-hidden="true" />}
                        onClick={() => {
                            setShowDeletePrompt(true);
                            setDeleteError('');
                        }}
                    >
                        Delete my account
                    </Button>
                ) : (
                    <form onSubmit={handleDeleteAccount} className="mt-4 max-w-sm space-y-4" noValidate>
                        <Input
                            id="delete-account-password"
                            type="password"
                            label="Current password"
                            required
                            autoComplete="current-password"
                            autoFocus
                            disabled={deleteSubmitting}
                            leftIcon={<KeyRound size={16} aria-hidden="true" />}
                            value={deletePassword}
                            onChange={(e) => setDeletePassword(e.target.value)}
                        />
                        <Input
                            id="delete-account-confirm"
                            type="text"
                            label="Type DELETE to confirm"
                            required
                            disabled={deleteSubmitting}
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                        />

                        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                            <span>Your vault entries, recovery key wrap, and 2FA setup are all permanently deleted.</span>
                        </div>

                        {deleteError && (
                            <div
                                role="alert"
                                className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                            >
                                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                <span>{deleteError}</span>
                            </div>
                        )}

                        <div className="flex gap-2">
                            <Button
                                type="submit"
                                variant="danger"
                                size="sm"
                                loading={deleteSubmitting}
                                disabled={deleteConfirmText !== 'DELETE'}
                            >
                                {deleteSubmitting ? 'Deleting…' : 'Permanently delete my account'}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={deleteSubmitting}
                                onClick={() => {
                                    setShowDeletePrompt(false);
                                    setDeletePassword('');
                                    setDeleteConfirmText('');
                                    setDeleteError('');
                                }}
                            >
                                Cancel
                            </Button>
                        </div>
                    </form>
                )}
            </Panel>
        </div>
    );
}
