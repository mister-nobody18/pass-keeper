import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useToast } from './ToastContext.jsx';
import { deriveKeys, generateKdfSalt, DEFAULT_KDF_PARAMS } from '../crypto/kdfClient.js';
import { encryptVault } from '../crypto/vaultCipher.js';
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
     * @param {string} email
     * @param {string} password
     * @param {(phase: 'deriving' | 'verifying') => void} [onPhase]
     */
    const login = useCallback(async (email, password, onPhase) => {
        onPhase?.('deriving');
        const { kdfSalt, kdfParams } = await api.getLoginSalt(email);
        const { authHash, encryptionKey } = await deriveKeys(password, kdfSalt, JSON.parse(kdfParams));

        onPhase?.('verifying');
        const data = await api.login({ email, authHash });

        setVaultKey(encryptionKey);
        setUser(data.user);
    }, []);

    /**
     * @param {string} email
     * @param {string} password
     * @param {(phase: 'deriving' | 'creating') => void} [onPhase]
     */
    const register = useCallback(async (email, password, onPhase) => {
        onPhase?.('deriving');
        const kdfSalt = generateKdfSalt();
        const { authHash, encryptionKey } = await deriveKeys(password, kdfSalt, DEFAULT_KDF_PARAMS);
        const vaultCiphertext = await encryptVault([], encryptionKey);

        onPhase?.('creating');
        const data = await api.register({
            email,
            authHash,
            kdfSalt,
            kdfParams: JSON.stringify(DEFAULT_KDF_PARAMS),
            vaultCiphertext,
        });

        setVaultKey(encryptionKey);
        setUser(data.user);
    }, []);

    const logout = useCallback(async () => {
        await api.logout();
        clearVaultKey();
        setUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{ user, setUser, loading, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
    return ctx;
}
