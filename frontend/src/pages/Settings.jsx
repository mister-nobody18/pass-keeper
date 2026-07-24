import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useVaultLock } from '../context/VaultLockContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { deriveKeys, generateKdfSalt, DEFAULT_KDF_PARAMS } from '../crypto/kdfClient.js';
import { encryptVault, decryptVault, VaultDecryptionError } from '../crypto/vaultCipher.js';
import { setVaultKey } from '../crypto/vaultKeyStore.js';
import TopBar from '../components/TopBar.jsx';
import Panel from '../components/ui/Panel.jsx';
import Input from '../components/ui/Input.jsx';
import Button from '../components/ui/Button.jsx';
import PasswordStrengthMeter from '../components/ui/PasswordStrengthMeter.jsx';

const PHASE_LABEL = {
    'deriving-current': 'Deriving current key…',
    'decrypting': 'Verifying current password…',
    'deriving-new': 'Deriving new key…',
    'saving': 'Saving…',
};

export default function Settings() {
    const { user } = useAuth();
    const { extend } = useVaultLock();
    const { showToast } = useToast();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [phase, setPhase] = useState(null);

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
            // 1. Re-derive the CURRENT key from the typed current password, using
            //    this account's existing (possibly older, lower-cost) stored params.
            setPhase('deriving-current');
            const { kdfSalt: currentSalt, kdfParams: currentParamsJson } = await api.getLoginSalt(user.email);
            const { authHash: currentAuthHash, encryptionKey: currentKey } = await deriveKeys(
                currentPassword,
                currentSalt,
                JSON.parse(currentParamsJson)
            );

            // 2. Prove that key is actually correct by using it for real, against
            //    the real vault - not just trusting the typed password. A wrong
            //    current password fails right here, locally, as a normal GCM
            //    decrypt failure (see crypto/vaultCipher.js), before any request
            //    that would touch the server's rate limit for this account.
            setPhase('decrypting');
            const { ciphertext, revision } = await api.getVault();
            let entries;
            try {
                entries = await decryptVault(ciphertext, currentKey);
            } catch (err) {
                if (err instanceof VaultDecryptionError) {
                    throw new Error('Current password is incorrect.');
                }
                throw err;
            }

            // 3. Derive a FRESH key from the new password, with a fresh salt and
            //    the current DEFAULT_KDF_PARAMS - this is how an account's KDF
            //    parameters actually get upgraded over time (see
            //    CONTRIBUTING.md): the next time this account picks a new
            //    password, it re-keys under whatever parameters are current then.
            setPhase('deriving-new');
            const newSalt = generateKdfSalt();
            const { authHash: newAuthHash, encryptionKey: newKey } = await deriveKeys(
                newPassword,
                newSalt,
                DEFAULT_KDF_PARAMS
            );
            const newVaultCiphertext = await encryptVault(entries, newKey);

            // 4. Server commits the new auth hash and the re-encrypted vault
            //    together, or neither - see backend-php/public_html/api/change_password.php.
            setPhase('saving');
            try {
                await api.changePassword({
                    currentAuthHash,
                    newAuthHash,
                    newKdfSalt: newSalt,
                    newKdfParams: JSON.stringify(DEFAULT_KDF_PARAMS),
                    newVaultCiphertext,
                    expectedVaultRevision: revision,
                });
            } catch (err) {
                if (err.isNetworkError) {
                    // The request may have reached the server and committed
                    // before the connection dropped - the server transaction
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

            setVaultKey(newKey);
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

    const submitting = phase !== null;

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
                    Your vault stays intact — it's decrypted and re-encrypted under your new password
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

            <Panel padding="lg">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h3 className="font-medium text-ink-primary">Two-factor authentication</h3>
                        <p className="text-sm text-ink-secondary">Add an authenticator app for extra login security.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-xs uppercase tracking-wide text-ink-tertiary">Coming soon</span>
                        <button
                            type="button"
                            disabled
                            title="Two-factor authentication is coming in a future update"
                            className="relative h-6 w-11 cursor-not-allowed rounded-full border border-line bg-surface opacity-60"
                        >
                            <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-ink-tertiary" />
                        </button>
                    </div>
                </div>
            </Panel>
        </div>
    );
}
