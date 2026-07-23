import db from '../db/index.js';
import {
    hashPassword,
    verifyPassword,
    generateKdfSalt,
    deriveKek,
    generateDek,
    wrapDek,
    unwrapDek,
} from './crypto.service.js';

const insertUserStmt = db.prepare(`
    INSERT INTO users (email, password_hash, kdf_salt, wrapped_dek)
    VALUES (@email, @passwordHash, @kdfSalt, @wrappedDek)
`);
const findByEmailStmt = db.prepare('SELECT * FROM users WHERE email = ?');
const findByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const updatePasswordStmt = db.prepare(`
    UPDATE users
    SET password_hash = @passwordHash, kdf_salt = @kdfSalt, wrapped_dek = @wrappedDek,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = @id
`);

export class AuthError extends Error {}

export async function registerUser(email, password) {
    const normalizedEmail = email.trim().toLowerCase();
    if (findByEmailStmt.get(normalizedEmail)) {
        throw new AuthError('An account with that email already exists.');
    }

    const passwordHash = await hashPassword(password);
    const kdfSalt = generateKdfSalt();
    const kek = await deriveKek(password, kdfSalt);
    const dek = generateDek();
    const wrappedDek = wrapDek(dek, kek);

    const info = insertUserStmt.run({ email: normalizedEmail, passwordHash, kdfSalt, wrappedDek });
    const user = findByIdStmt.get(info.lastInsertRowid);
    return { user, dek };
}

export async function verifyLogin(email, password) {
    const user = findByEmailStmt.get(email.trim().toLowerCase());
    if (!user) throw new AuthError('Invalid email or password.');

    const passwordOk = await verifyPassword(user.password_hash, password);
    if (!passwordOk) throw new AuthError('Invalid email or password.');

    let dek;
    try {
        const kek = await deriveKek(password, user.kdf_salt);
        dek = unwrapDek(user.wrapped_dek, kek);
    } catch {
        // Should only happen if the DB was tampered with independently of the password check.
        throw new AuthError('Invalid email or password.');
    }

    return { user, dek };
}

export async function changePassword(userId, oldPassword, newPassword) {
    const user = findByIdStmt.get(userId);
    if (!user) throw new AuthError('User not found.');

    const passwordOk = await verifyPassword(user.password_hash, oldPassword);
    if (!passwordOk) throw new AuthError('Current password is incorrect.');

    const oldKek = await deriveKek(oldPassword, user.kdf_salt);
    const dek = unwrapDek(user.wrapped_dek, oldKek);

    const newKdfSalt = generateKdfSalt();
    const newKek = await deriveKek(newPassword, newKdfSalt);
    const newWrappedDek = wrapDek(dek, newKek);
    const newPasswordHash = await hashPassword(newPassword);

    updatePasswordStmt.run({
        id: userId,
        passwordHash: newPasswordHash,
        kdfSalt: newKdfSalt,
        wrappedDek: newWrappedDek,
    });

    return dek;
}

export function findUserById(id) {
    return findByIdStmt.get(id);
}

export function toPublicUser(user) {
    return {
        id: user.id,
        email: user.email,
        twoFaEnabled: !!user.two_fa_enabled,
        createdAt: user.created_at,
    };
}
