// Envelope encryption for the vault's Data Encryption Key (DEK). The DEK is
// what actually encrypts the vault (see vaultCipher.js); it is itself
// wrapped (encrypted) under one or two independent keys — one derived from
// the master password, optionally a second derived from a recovery key —
// so either one alone can recover the SAME DEK. See docs/ARCHITECTURE.md §5
// and CONTRIBUTING.md's crypto-parameters section before changing anything
// in this file.
//
// Uses native WebCrypto wrapKey()/unwrapKey() rather than manual
// export-then-encrypt: the DEK's raw bytes are never returned to, or
// visible in, JS at any point during a wrap or an unwrap.

import { bytesToBase64, base64ToBytes } from './base64.js';

const WRAP_ENVELOPE_VERSION = 1;
const IV_LENGTH_BYTES = 12;

export class DekUnwrapError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DekUnwrapError';
    }
}

/**
 * Generates a fresh 256-bit AES-GCM DEK. `extractable: true` is required
 * here — WebCrypto's wrapKey() throws InvalidAccessError on a
 * non-extractable key, since wrapping fundamentally requires the browser to
 * export the key's raw bytes internally before encrypting them (JS code
 * itself never sees those bytes; only wrapKey()'s ciphertext output is
 * ever returned).
 *
 * This extractable reference is meant to be used ONLY to call wrapDek()
 * one or more times and then discarded. Callers should obtain their actual
 * working copy of the DEK by immediately unwrapping one of those envelopes
 * again with unwrapDek() (which always returns a non-extractable key), so
 * the key that ends up in vaultKeyStore.js is never the transiently-
 * extractable one — see AuthContext.jsx's register() for the pattern.
 */
export async function generateDek() {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Wraps `dek` (must be extractable) under `wrappingKey`, with a fresh IV every single call. */
export async function wrapDek(dek, wrappingKey) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
    const wrapped = await crypto.subtle.wrapKey('raw', dek, wrappingKey, { name: 'AES-GCM', iv });
    return JSON.stringify({
        v: WRAP_ENVELOPE_VERSION,
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(wrapped)),
    });
}

/**
 * Unwraps an envelope produced by wrapDek() back into a usable DEK — always
 * non-extractable, regardless of which wrapping key unwrapped it. Throws
 * DekUnwrapError (never a raw DOMException) on any failure — a wrong
 * wrapping key (wrong master password, or wrong recovery key) and
 * tampered/corrupted data both collapse to this one clean, catchable error
 * type, the same reasoning as VaultDecryptionError in vaultCipher.js.
 */
export async function unwrapDek(envelopeString, wrappingKey) {
    let envelope;
    try {
        envelope = JSON.parse(envelopeString);
    } catch {
        throw new DekUnwrapError('The wrapped key is not readable.');
    }

    if (
        !envelope ||
        envelope.v !== WRAP_ENVELOPE_VERSION ||
        typeof envelope.iv !== 'string' ||
        typeof envelope.data !== 'string'
    ) {
        throw new DekUnwrapError('The wrapped key is not in a recognised format.');
    }

    try {
        const iv = base64ToBytes(envelope.iv);
        const wrappedBytes = base64ToBytes(envelope.data);
        return await crypto.subtle.unwrapKey(
            'raw',
            wrappedBytes,
            wrappingKey,
            { name: 'AES-GCM', iv },
            { name: 'AES-GCM', length: 256 },
            false, // always non-extractable for real use
            ['encrypt', 'decrypt']
        );
    } catch {
        throw new DekUnwrapError('Could not unwrap the key. The password or recovery key may be incorrect.');
    }
}

/**
 * Same as unwrapDek(), except the result is `extractable: true`. This
 * exists for exactly one legitimate purpose: re-wrapping the SAME DEK
 * under a *different* key (changing the master password, or setting up/
 * rotating the recovery-key wrap) — wrapKey() requires an extractable
 * source key, and unwrapDek()'s result deliberately isn't one. Do not use
 * this for anything that just needs to *use* the DEK to encrypt/decrypt
 * the vault — use unwrapDek() for that, so the working copy of the key
 * stays non-extractable everywhere except this one narrow re-wrap step.
 */
export async function unwrapDekForRewrap(envelopeString, wrappingKey) {
    let envelope;
    try {
        envelope = JSON.parse(envelopeString);
    } catch {
        throw new DekUnwrapError('The wrapped key is not readable.');
    }

    if (
        !envelope ||
        envelope.v !== WRAP_ENVELOPE_VERSION ||
        typeof envelope.iv !== 'string' ||
        typeof envelope.data !== 'string'
    ) {
        throw new DekUnwrapError('The wrapped key is not in a recognised format.');
    }

    try {
        const iv = base64ToBytes(envelope.iv);
        const wrappedBytes = base64ToBytes(envelope.data);
        return await crypto.subtle.unwrapKey(
            'raw',
            wrappedBytes,
            wrappingKey,
            { name: 'AES-GCM', iv },
            { name: 'AES-GCM', length: 256 },
            true, // extractable - see the doc comment above for why this is the one exception
            ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
        );
    } catch {
        throw new DekUnwrapError('Could not unwrap the key. The password or recovery key may be incorrect.');
    }
}
