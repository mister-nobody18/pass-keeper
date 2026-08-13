import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useToast } from './ToastContext.jsx';
import { deriveKeys, generateKdfSalt, DEFAULT_KDF_PARAMS } from '../crypto/kdfClient.js';
import { encryptVault } from '../crypto/vaultCipher.js';
import { generateDek, wrapDek, unwrapDek } from '../crypto/dek.js';
import { generateRecoveryKey, deriveRecoveryWrapKey } from '../crypto/recoveryKey.js';
import { resolveDekAfterLogin } from '../crypto/legacyMigration.js';
import { setVaultKey, clearVaultKey } from '../crypto/vaultKeyStore.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();

    useEffect(() => {
        // A page load never has the vault encryption key (see
        // crypto/vaultKeyStore.js - it's JS-memory-only and reset on every
        // reload by construction), regardless of whether the PHP session
        // cookie is still valid. This only restores *identity* (so the app
        // can show "Unlock for you@example.com" instead of a blank login
        // form) - VaultLockContext is what decides whether the vault itself
        // needs unlocking.
        api.me()
            .then((data) => setUser(data.user))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    // Fired by api/client.js whenever an authenticated request comes back 401 - e.g. the real
    // server-side session expired independently of the client-side idle lock. Without this, a
    // stale `user` would linger in the UI while every API call silently failed.
    useEffect(() => {
        function handleSessionExpired() {
            clearVaultKey(); // the server no longer considers this session valid; holding the key serves no purpose
            setUser((current) => {
                if (current) {
                    showToast({ tone: 'danger', message: 'Your session expired. Please sign in again.' });
                }
                return null;
            });
        }
        window.addEventListener('pk:session-expired', handleSessionExpired);
        return () => window.removeEventListener('pk:session-expired', handleSessionExpired);
    }, [showToast]);

    /**
     * Does NOT call setUser()/setVaultKey() when the account has 2FA
     * enabled and this isn't a recognized device - the password alone
     * isn't enough to finish logging in yet. The caller must then show a
     * code-entry step and call completeTwoFactor() with the returned
     * `passwordWrapKey` to actually finish. See lib/totp.php's server-side
     * gate (login.php) for exactly when this branch is (and isn't) taken -
     * notably, never on an idle-unlock re-entry.
     *
     * @param {string} email
     * @param {string} password
     * @param {(phase: 'deriving' | 'verifying' | 'upgrading') => void} [onPhase]
     * @returns {Promise<{ twoFactorRequired: true, passwordWrapKey: CryptoKey } | undefined>}
     */
    const login = useCallback(async (email, password, onPhase) => {
        onPhase?.('deriving');
        const { kdfSalt, kdfParams } = await api.getLoginSalt(email);
        const { authHash, encryptionKey: passwordWrapKey } = await deriveKeys(password, kdfSalt, JSON.parse(kdfParams));

        onPhase?.('verifying');
        const data = await api.login({ email, authHash });

        if (data.twoFactorRequired) {
            return { twoFactorRequired: true, passwordWrapKey };
        }

        // Resolves to the vault's DEK on the normal path. On a legacy
        // account (predates the DEK/envelope model - real account, real
        // data, no wrappedDekPassword yet) this transparently migrates it
        // on the spot instead - see crypto/legacyMigration.js.
        const dek = await resolveDekAfterLogin(data, passwordWrapKey, onPhase);

        setVaultKey(dek);
        setUser(data.user);
    }, []);

    /**
     * Finishes a login that was interrupted by login()'s twoFactorRequired
     * signal, once the user has entered their code. Reuses the exact same
     * resolveDekAfterLogin() finish every other successful-login path uses.
     *
     * @param {string} code
     * @param {boolean} rememberDevice
     * @param {CryptoKey} passwordWrapKey - from login()'s twoFactorRequired result
     * @param {(phase: 'upgrading') => void} [onPhase]
     */
    const completeTwoFactor = useCallback(async (code, rememberDevice, passwordWrapKey, onPhase) => {
        const data = await api.totpVerify({ code, rememberDevice });
        const dek = await resolveDekAfterLogin(data, passwordWrapKey, onPhase);
        setVaultKey(dek);
        setUser(data.user);
    }, []);

    /**
     * Deliberately does NOT call setUser() itself. Register.jsx shows the
     * recovery key exactly once before the user can navigate anywhere else -
     * if this set the `user` state directly, PublicOnlyRoute (which /register
     * is wrapped in) would redirect to "/" the instant that state changed,
     * racing ahead of and unmounting the recovery-key screen before it could
     * even render. The caller finalizes login by calling setUser itself
     * (exposed on this context) once the user has acknowledged the key.
     *
     * @param {string} email
     * @param {string} password
     * @param {{ onPhase?: (phase: 'deriving' | 'creating') => void, includeRecoveryKey?: boolean }} [options]
     * @returns {Promise<{ recoveryKey: string | null, user: object, dek: CryptoKey }>}
     */
    const register = useCallback(async (email, password, { onPhase, includeRecoveryKey = true } = {}) => {
        onPhase?.('deriving');
        const kdfSalt = generateKdfSalt();
        const { authHash, encryptionKey: passwordWrapKey } = await deriveKeys(password, kdfSalt, DEFAULT_KDF_PARAMS);

        // Generate the vault's DEK once, wrap it under the password (always)
        // and optionally under a fresh recovery key too - see
        // crypto/dek.js: wrapKey() needs an extractable source key, which
        // generateDek() provides; the working copy we actually use going
        // forward is obtained by unwrapping again further down, which is
        // always non-extractable.
        const extractableDek = await generateDek();
        const wrappedDekPassword = await wrapDek(extractableDek, passwordWrapKey);

        let wrappedDekRecovery = null;
        let recoveryKey = null;
        if (includeRecoveryKey) {
            const { raw, formatted } = generateRecoveryKey();
            const recoveryWrapKey = await deriveRecoveryWrapKey(raw);
            wrappedDekRecovery = await wrapDek(extractableDek, recoveryWrapKey);
            recoveryKey = formatted;
        }

        const dek = await unwrapDek(wrappedDekPassword, passwordWrapKey);
        const vaultCiphertext = await encryptVault([], dek);

        onPhase?.('creating');
        const data = await api.register({
            email,
            authHash,
            kdfSalt,
            kdfParams: JSON.stringify(DEFAULT_KDF_PARAMS),
            wrappedDekPassword,
            wrappedDekRecovery,
            vaultCiphertext,
        });

        return { recoveryKey, user: data.user, dek };
    }, []);

    const logout = useCallback(async () => {
        await api.logout();
        clearVaultKey();
        setUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{ user, setUser, loading, login, completeTwoFactor, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
    return ctx;
}
