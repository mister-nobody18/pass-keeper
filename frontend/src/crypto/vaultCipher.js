// AES-256-GCM encryption of the whole vault via native WebCrypto, using the
// non-extractable CryptoKey produced by kdfClient.deriveKeys(). Fast enough
// (hardware-accelerated, single-digit milliseconds even for a large vault)
// to run directly on the main thread - unlike the KDF, it needs no worker
// or loading state.

import { bytesToBase64, base64ToBytes } from './base64.js';

const ENVELOPE_VERSION = 1;
const IV_LENGTH_BYTES = 12; // 96 bits - the size WebCrypto's AES-GCM is designed for

export class VaultDecryptionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VaultDecryptionError';
    }
}

/**
 * Encrypts `entries` (this app always passes the vault's entries array)
 * under `encryptionKey`, with a fresh random IV generated on every single
 * call - never cached, never reused. Returns the opaque envelope string the
 * server stores verbatim and never parses.
 */
export async function encryptVault(entries, encryptionKey) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
    const plaintext = new TextEncoder().encode(JSON.stringify(entries));

    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, plaintext);

    return JSON.stringify({
        v: ENVELOPE_VERSION,
        iv: bytesToBase64(iv),
        // WebCrypto appends the GCM authentication tag to the ciphertext
        // output automatically - there is no separate tag to manage here.
        data: bytesToBase64(new Uint8Array(ciphertext)),
    });
}

/**
 * Decrypts an envelope produced by encryptVault(). Always throws
 * VaultDecryptionError (never a raw DOMException) on failure - a wrong key,
 * tampered/corrupted ciphertext, and an unrecognised envelope shape all
 * collapse to the same clean, catchable error type. AES-GCM deliberately
 * does not distinguish "wrong key" from "tampered data" (that's the point
 * of an authenticated cipher), so neither can this function - callers
 * decide what that means in context (see docs/ARCHITECTURE.md).
 */
export async function decryptVault(envelopeString, encryptionKey) {
    let envelope;
    try {
        envelope = JSON.parse(envelopeString);
    } catch {
        throw new VaultDecryptionError('The vault data is not readable.');
    }

    if (
        !envelope ||
        envelope.v !== ENVELOPE_VERSION ||
        typeof envelope.iv !== 'string' ||
        typeof envelope.data !== 'string'
    ) {
        throw new VaultDecryptionError('The vault data is not in a recognised format.');
    }

    let plaintextBytes;
    try {
        const iv = base64ToBytes(envelope.iv);
        const ciphertext = base64ToBytes(envelope.data);
        plaintextBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encryptionKey, ciphertext);
    } catch {
        // Surfaced as a normal, catchable error - never an unhandled
        // rejection or a crash. This is the "wrong password" case in
        // practice for the unlock/re-key flows: see docs/ARCHITECTURE.md.
        throw new VaultDecryptionError(
            'Could not decrypt the vault. The password may be incorrect, or the key may be out of date.'
        );
    }

    try {
        return JSON.parse(new TextDecoder().decode(plaintextBytes));
    } catch {
        throw new VaultDecryptionError('The decrypted vault data is not readable.');
    }
}
