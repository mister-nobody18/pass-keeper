import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { api } from '../api/client.js';
import { deriveKeys } from '../crypto/kdfClient.js';
import { setVaultKey, clearVaultKey, hasVaultKey } from '../crypto/vaultKeyStore.js';

// Client-side idle lock: independent of the server session's own TTL, which
// we don't have a way to read from the frontend without a backend change.
// This is the common "lock the UI after N minutes of inactivity" pattern
// password managers use - it hides vault contents in the tab well before
// the underlying server session would ever expire on its own. Unlocking
// re-derives the encryption key from the password and re-runs a real login
// (extending the real server session as a side effect) - it isn't just a
// client-side flag.
const IDLE_LOCK_MS = 5 * 60 * 1000;
const TICK_MS = 1000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];

const VaultLockContext = createContext(null);

export function VaultLockProvider({ children }) {
    const { user } = useAuth();
    // Starts locked whenever there's no encryption key already in memory -
    // true on first mount after any page load/reload (the key never
    // survives one, by design - see crypto/vaultKeyStore.js), false when
    // navigating between routes within the same still-unlocked page session.
    const [locked, setLocked] = useState(() => !hasVaultKey());
    const [remainingMs, setRemainingMs] = useState(IDLE_LOCK_MS);
    const lastActivityRef = useRef(Date.now());

    const extend = useCallback(() => {
        lastActivityRef.current = Date.now();
        setRemainingMs(IDLE_LOCK_MS);
    }, []);

    const lock = useCallback(() => {
        clearVaultKey();
        setLocked(true);
    }, []);

    /**
     * @param {string} password
     * @param {(phase: 'deriving' | 'verifying') => void} [onPhase]
     */
    const unlock = useCallback(
        async (password, onPhase) => {
            onPhase?.('deriving');
            const { kdfSalt, kdfParams } = await api.getLoginSalt(user.email);
            const { authHash, encryptionKey } = await deriveKeys(password, kdfSalt, JSON.parse(kdfParams));

            onPhase?.('verifying');
            await api.login({ email: user.email, authHash });

            setVaultKey(encryptionKey);
            setLocked(false);
            extend();
        },
        [user, extend]
    );

    useEffect(() => {
        if (!user || locked) return undefined;

        function onActivity() {
            lastActivityRef.current = Date.now();
        }
        ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));

        const interval = setInterval(() => {
            const remaining = IDLE_LOCK_MS - (Date.now() - lastActivityRef.current);
            if (remaining <= 0) {
                setRemainingMs(0);
                clearVaultKey();
                setLocked(true);
            } else {
                setRemainingMs(remaining);
            }
        }, TICK_MS);

        return () => {
            ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
            clearInterval(interval);
        };
    }, [user, locked]);

    useEffect(() => {
        if (!user) {
            clearVaultKey();
            setLocked(true);
            setRemainingMs(IDLE_LOCK_MS);
        }
    }, [user]);

    return (
        <VaultLockContext.Provider value={{ locked, remainingMs, idleLockMs: IDLE_LOCK_MS, extend, lock, unlock }}>
            {children}
        </VaultLockContext.Provider>
    );
}

export function useVaultLock() {
    const ctx = useContext(VaultLockContext);
    if (!ctx) throw new Error('useVaultLock must be used within a VaultLockProvider');
    return ctx;
}
