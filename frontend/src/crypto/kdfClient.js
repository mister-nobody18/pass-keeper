// Main-thread interface to kdfWorker.js. Every Argon2id + HKDF derivation in
// the app goes through deriveKeys() below, which runs off the main thread so
// the UI can show a live loading state during the ~1-2s computation instead
// of freezing. See docs/ARCHITECTURE.md "Client crypto flow" for the full
// pipeline and timing rationale.

// These are the parameters used for every NEW registration. Existing
// accounts keep whatever params they registered (or last changed their
// password) with - see the `kdfParams` argument to deriveKeys() below,
// which must always come from the account's stored params, never this
// constant, except at registration time.
//
// Measured ~160ms average for this exact (memory, iterations) pair via
// libsodium-wrappers-sumo in real headless Chromium on an AMD Ryzen 7 4800H
// desktop; targeting roughly 1-1.5s on a mid-range phone via a conservative
// 6x mobile-slowdown estimate (not measured on physical mobile hardware -
// re-validate on real devices before relying on this number). Must match
// backend-php/config/config.example.php's `fake_kdf_params`. See
// CONTRIBUTING.md's "Crypto parameters and primitives" section before
// changing any value here.
export const DEFAULT_KDF_PARAMS = Object.freeze({
    algorithm: 'argon2id',
    memory: 65536, // KiB (64 MiB)
    iterations: 3,
    parallelism: 1, // fixed by libsodium's crypto_pwhash API; stored for forward-compatibility only
});

let worker = null;
let nextRequestId = 1;
const pending = new Map();

function getWorker() {
    if (!worker) {
        worker = new Worker(new URL('./kdfWorker.js', import.meta.url), { type: 'module' });

        worker.onmessage = (event) => {
            const { id, authHash, encryptionKey, error } = event.data;
            const resolver = pending.get(id);
            if (!resolver) return;
            pending.delete(id);
            if (error) {
                resolver.reject(new Error(error));
            } else {
                resolver.resolve({ authHash, encryptionKey });
            }
        };

        worker.onerror = () => {
            // A worker-level failure (e.g. the WASM module failed to load)
            // has no request id to route to - reject every request
            // currently in flight rather than leaving callers hanging.
            for (const [id, resolver] of pending) {
                resolver.reject(new Error('Key derivation failed to run.'));
                pending.delete(id);
            }
        };
    }
    return worker;
}

/**
 * Derives {authHash, encryptionKey} from a master password. `kdfParams` must
 * be the account's *stored* parameters (from registration, or a
 * login-salt lookup) - never assume DEFAULT_KDF_PARAMS still applies to an
 * existing account, since per-user params exist specifically so they can be
 * raised later without invalidating accounts that haven't re-keyed yet.
 *
 * @param {string} password
 * @param {string} kdfSalt base64
 * @param {{memory:number, iterations:number, parallelism:number}} kdfParams
 * @returns {Promise<{authHash: string, encryptionKey: CryptoKey}>}
 */
export function deriveKeys(password, kdfSalt, kdfParams) {
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        getWorker().postMessage({ id, password, kdfSalt, kdfParams });
    });
}

/** A fresh random 16-byte salt (libsodium's argon2id SALTBYTES), base64-encoded. */
export function generateKdfSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}
