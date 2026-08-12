// Runs inside a dedicated Web Worker (see kdfClient.js) so the ~1-2s Argon2id
// computation never blocks the main thread - the UI stays responsive and can
// render a live loading state - and so the raw master-key and encryption-key
// bytes never touch the main thread's JS heap at all. Only the final,
// non-extractable AES-GCM CryptoKey and the (already-one-way-derived) auth
// hash string cross back to the page. See docs/ARCHITECTURE.md "Client
// crypto flow" for the full pipeline and CONTRIBUTING.md before changing
// anything in this file.
import sodium from 'libsodium-wrappers-sumo';

// Domain-separation labels for HKDF-Expand. Splitting one master key into
// two independent-looking outputs (an auth proof and an encryption key) is
// exactly what HKDF's `info` parameter is for - see RFC 5869 §3.2. The salt
// is intentionally empty: the Argon2id step above already used a proper
// random per-user salt to go from password -> master key, so HKDF's own
// salt would only add domain separation that `info` already provides.
const AUTH_INFO = new TextEncoder().encode('pass-keeper-auth-v1');
const ENC_INFO = new TextEncoder().encode('pass-keeper-enc-v1');

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

async function deriveKeys(password, kdfSaltB64, kdfParams) {
    await sodium.ready;

    const salt = base64ToBytes(kdfSaltB64);
    const memoryBytes = kdfParams.memory * 1024; // kdfParams.memory is stored/transmitted in KiB; libsodium wants bytes

    // Step 1: password -> 256-bit master key. This is the deliberately slow,
    // memory-hard step - see CONTRIBUTING.md for why these parameters are
    // not to be changed casually.
    const masterKeyBytes = sodium.crypto_pwhash(
        32,
        password,
        salt,
        kdfParams.iterations,
        memoryBytes,
        sodium.crypto_pwhash_ALG_ARGON2ID13
    );

    // Step 2: split the master key into two independent 256-bit values via
    // HKDF (native WebCrypto - no hand-rolled HMAC/HKDF here).
    const ikm = await crypto.subtle.importKey('raw', masterKeyBytes, 'HKDF', false, ['deriveBits']);

    const authBits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: AUTH_INFO },
        ikm,
        256
    );
    const encBits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: ENC_INFO },
        ikm,
        256
    );

    // Step 3: import the encryption half as a non-extractable AES-GCM key.
    // `extractable: false` means no code anywhere - not even this worker,
    // once this call returns - can call exportKey() and recover the raw
    // bytes. Usages are 'wrapKey'/'unwrapKey', not 'encrypt'/'decrypt': this
    // key's only job is to wrap/unwrap the vault's DEK (see crypto/dek.js) -
    // it never encrypts vault data directly. WebCrypto enforces usages
    // strictly, so wrapKey()/unwrapKey() calls would throw if this key were
    // only granted 'encrypt'/'decrypt'.
    const encryptionKey = await crypto.subtle.importKey(
        'raw',
        encBits,
        'AES-GCM',
        false,
        ['wrapKey', 'unwrapKey']
    );

    const authHash = bytesToBase64(new Uint8Array(authBits));

    // Best-effort wipe of transient raw buffers. This does NOT guarantee the
    // JS engine's actual memory is cleared - JavaScript gives no such
    // guarantee, and the GC may already have copied these bytes elsewhere -
    // but it's the standard available practice and shrinks the window
    // during which the raw bytes are reachable through a plain reference.
    masterKeyBytes.fill(0);
    new Uint8Array(authBits).fill(0);
    new Uint8Array(encBits).fill(0);

    return { authHash, encryptionKey };
}

self.onmessage = async (event) => {
    const { id, password, kdfSalt, kdfParams } = event.data;
    try {
        const { authHash, encryptionKey } = await deriveKeys(password, kdfSalt, kdfParams);
        // `encryptionKey` is a CryptoKey, which is structured-clonable - it
        // crosses the worker boundary as a live, still-non-extractable key,
        // not as raw bytes.
        self.postMessage({ id, authHash, encryptionKey });
    } catch (err) {
        self.postMessage({ id, error: err?.message || 'Key derivation failed.' });
    }
};
