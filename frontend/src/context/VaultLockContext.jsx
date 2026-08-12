import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { api } from '../api/client.js';
import { deriveKeys } from '../crypto/kdfClient.js';
import { unwrapDek } from '../crypto/dek.js';
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
    const lastActivityRef = useRef(Date.now());

    // Deliberately NOT React state. Every consumer of this context (e.g.
    // Dashboard.jsx, for `lock`/`locked`) would re-render on every change to
    // the context value - if the live countdown lived here as state, every
    // one of those consumers would re-render once a second regardless of
    // whether they use the countdown at all. That was the root cause of a
    // real bug: it cascaded into remounting/re-triggering effects in open
    // modals, stealing input focus every second. AutoLockTimer.jsx reads the
    // countdown via getRemainingMs() on its own local 1-second interval
    // instead, so only that one small leaf component re-renders each tick.
    const getRemainingMs = useCallback(() => {
        return Math.max(0, IDLE_LOCK_MS - (Date.now() - lastActivityRef.current));
    }, []);

    const extend = useCallback(() => {
        lastActivityRef.current = Date.now();
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
            const { authHash, encryptionKey: passwordWrapKey } = await deriveKeys(password, kdfSalt, JSON.parse(kdfParams));

            onPhase?.('verifying');
            const data = await api.login({ email: user.email, authHash });
            const dek = await unwrapDek(data.wrappedDekPassword, passwordWrapKey);

            setVaultKey(dek);
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

        // This interval only needs to notice when time has actually run out
        // (a rare event) - it does not need to update any per-tick display
        // state itself. AutoLockTimer.jsx ticks its own display independently.
        const interval = setInterval(() => {
            if (getRemainingMs() <= 0) {
                clearVaultKey();
                setLocked(true);
            }
        }, TICK_MS);

        return () => {
            ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
            clearInterval(interval);
        };
    }, [user, locked, getRemainingMs]);

    useEffect(() => {
        if (!user) {
            clearVaultKey();
            setLocked(true);
            lastActivityRef.current = Date.now();
        }
    }, [user]);

    // Memoized so the context value's identity only changes when `locked`
    // actually flips - not on every render of some unrelated ancestor. Every
    // function here is itself referentially stable (useCallback with fixed
    // deps), so this object is now stable across renders where `locked`
    // doesn't change, and consumers that only care about `lock`/`unlock`/
    // `extend` (not the live countdown) don't re-render on the 1Hz tick at all.
    const value = useMemo(
        () => ({ locked, idleLockMs: IDLE_LOCK_MS, getRemainingMs, extend, lock, unlock }),
        [locked, getRemainingMs, extend, lock, unlock]
    );

    return <VaultLockContext.Provider value={value}>{children}</VaultLockContext.Provider>;
}

export function useVaultLock() {
    const ctx = useContext(VaultLockContext);
    if (!ctx) throw new Error('useVaultLock must be used within a VaultLockProvider');
    return ctx;
}
