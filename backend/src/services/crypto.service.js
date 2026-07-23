import argon2 from 'argon2';
import crypto from 'node:crypto';

const PEPPER = process.env.ENCRYPTION_PEPPER || '';
if (!PEPPER && process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_PEPPER must be set in production - refusing to start without it.');
}

// Argon2id tuning. These apply both to the login auth-hash and to KEK derivation.
const ARGON2_OPTS = {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 1,
};

const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // recommended for GCM
const ALGO = 'aes-256-gcm';

function withPepper(password) {
    return `${password}${PEPPER}`;
}

/** Hash a master password for storage/verification at login (argon2id, salted internally). */
export async function hashPassword(password) {
    return argon2.hash(withPepper(password), ARGON2_OPTS);
}

export async function verifyPassword(hash, password) {
    return argon2.verify(hash, withPepper(password));
}

/** Random base64 salt to store alongside a user, used only for KEK derivation. */
export function generateKdfSalt() {
    return crypto.randomBytes(16).toString('base64');
}

/** Derive a raw 32-byte Key-Encryption-Key from the master password + stored salt. Never persisted. */
export async function deriveKek(password, kdfSaltBase64) {
    return argon2.hash(withPepper(password), {
        ...ARGON2_OPTS,
        raw: true,
        hashLength: KEY_LENGTH,
        salt: Buffer.from(kdfSaltBase64, 'base64'),
    });
}

/** Random 32-byte Data Encryption Key, generated once per user at registration. */
export function generateDek() {
    return crypto.randomBytes(KEY_LENGTH);
}

function encryptBuffer(plainBuffer, keyBuffer) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGO, keyBuffer, iv);
    const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, ciphertext].map((b) => b.toString('base64url')).join('.');
}

function decryptBuffer(payload, keyBuffer) {
    const [ivB64, tagB64, ciphertextB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !ciphertextB64) {
        throw new Error('Malformed ciphertext payload');
    }
    const iv = Buffer.from(ivB64, 'base64url');
    const authTag = Buffer.from(tagB64, 'base64url');
    const ciphertext = Buffer.from(ciphertextB64, 'base64url');
    const decipher = crypto.createDecipheriv(ALGO, keyBuffer, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Wrap the DEK with the KEK for storage. */
export function wrapDek(dekBuffer, kekBuffer) {
    return encryptBuffer(dekBuffer, kekBuffer);
}

/** Unwrap the stored DEK using the KEK derived at login. */
export function unwrapDek(wrappedDek, kekBuffer) {
    return decryptBuffer(wrappedDek, kekBuffer);
}

/** Encrypt a vault field (password, notes) with the user's plaintext DEK. */
export function encryptField(plainText, dekBuffer) {
    if (plainText === null || plainText === undefined) return null;
    return encryptBuffer(Buffer.from(plainText, 'utf8'), dekBuffer);
}

/** Decrypt a vault field with the user's plaintext DEK. */
export function decryptField(payload, dekBuffer) {
    if (payload === null || payload === undefined) return null;
    return decryptBuffer(payload, dekBuffer).toString('utf8');
}
