// The recovery key: a high-entropy random value generated client-side,
// shown to the user exactly once, that can independently unwrap the
// vault's DEK if the master password is lost (see crypto/dek.js and
// docs/ARCHITECTURE.md §5). Never sent to or stored by the server in any
// form — only the DEK it wraps (itself opaque ciphertext) is.
//
// Unlike the master password, this value is never typed by a human when
// created (it's fully random) and has no dictionary/pattern to attack, so
// deriving a wrap key from it uses fast HKDF, not Argon2id — there's
// nothing for a slow KDF to protect against here that 160 bits of real
// entropy doesn't already provide. No Web Worker is needed for this path.

const RECOVERY_KEY_BYTES = 20; // 160 bits
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_WRAP_INFO = new TextEncoder().encode('pass-keeper-recovery-wrap-v1');

function base32Encode(bytes) {
    let bits = '';
    for (const byte of bytes) {
        bits += byte.toString(2).padStart(8, '0');
    }
    let output = '';
    for (let i = 0; i < bits.length; i += 5) {
        const chunk = bits.slice(i, i + 5).padEnd(5, '0');
        output += BASE32_ALPHABET[parseInt(chunk, 2)];
    }
    return output;
}

function base32Decode(cleanedInput) {
    let bits = '';
    for (const char of cleanedInput) {
        const index = BASE32_ALPHABET.indexOf(char);
        if (index === -1) {
            throw new Error("That doesn't look like a valid recovery key.");
        }
        bits += index.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return new Uint8Array(bytes);
}

export function formatRecoveryKey(rawBytes) {
    const encoded = base32Encode(rawBytes);
    return encoded.match(/.{1,4}/g).join('-');
}

/** Generates a fresh recovery key. `raw` is what crypto derives from; `formatted` is what's shown to the user. */
export function generateRecoveryKey() {
    const raw = crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_BYTES));
    return { raw, formatted: formatRecoveryKey(raw) };
}

/**
 * Parses a user-typed/pasted recovery key back into raw bytes, tolerating
 * whatever dashes/spacing/casing they typed it with. Throws a plain, clean
 * Error with a human-readable message on malformed input (never reaches
 * WebCrypto with garbage) - a *wrong but well-formed* key is a separate,
 * later failure surfaced by dek.js's DekUnwrapError instead.
 */
export function parseRecoveryKey(input) {
    const cleaned = String(input).toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z2-7]+$/.test(cleaned)) {
        throw new Error("That doesn't look like a valid recovery key.");
    }
    const raw = base32Decode(cleaned);
    if (raw.length !== RECOVERY_KEY_BYTES) {
        throw new Error('That recovery key is the wrong length — check you copied all of it.');
    }
    return raw;
}

/** Derives the AES-GCM key used to wrap/unwrap the DEK from raw recovery-key bytes. */
export async function deriveRecoveryWrapKey(rawRecoveryKeyBytes) {
    const ikm = await crypto.subtle.importKey('raw', rawRecoveryKeyBytes, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: RECOVERY_WRAP_INFO },
        ikm,
        { name: 'AES-GCM', length: 256 },
        false,
        ['wrapKey', 'unwrapKey']
    );
}
