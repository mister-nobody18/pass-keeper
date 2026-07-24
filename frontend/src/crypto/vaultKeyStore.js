// The ONLY place the vault's AES-256-GCM encryption key is held in this app.
// A plain module-level variable, deliberately outside React state/context:
// React DevTools can inspect component state and context values, which
// would make the key visible to anyone with devtools access if it lived
// there instead. Never written to localStorage, sessionStorage, IndexedDB,
// or a cookie - it exists only for the lifetime of this module in this tab.
//
// The key itself is always a non-extractable WebCrypto CryptoKey (see
// crypto/kdfWorker.js) - even code with a direct reference to it can't call
// crypto.subtle.exportKey() to recover the raw bytes. This store only ever
// holds that opaque handle, never raw key material.

let currentKey = null;

export function setVaultKey(key) {
    currentKey = key;
}

export function getVaultKey() {
    return currentKey;
}

export function clearVaultKey() {
    currentKey = null;
}

export function hasVaultKey() {
    return currentKey !== null;
}

// Best-effort: drop the in-memory key when the tab is being unloaded or
// hidden in a way that could precede the process being killed (mobile
// browsers routinely discard backgrounded tabs without a reliable
// 'unload' event, which is why both listeners are registered). This can't
// erase anything the JS engine already copied elsewhere internally (no such
// guarantee exists in JavaScript) - see docs/ARCHITECTURE.md's notes on the
// real limits of "wiping" memory from application code.
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', clearVaultKey);
    window.addEventListener('beforeunload', clearVaultKey);
}
