import db from '../db/index.js';
import { encryptField, decryptField } from './crypto.service.js';

const listStmt = db.prepare('SELECT * FROM vault_entries WHERE user_id = ? ORDER BY platform_name COLLATE NOCASE');
const getStmt = db.prepare('SELECT * FROM vault_entries WHERE id = ? AND user_id = ?');
const insertStmt = db.prepare(`
    INSERT INTO vault_entries (user_id, platform_name, username, encrypted_password, url, encrypted_notes)
    VALUES (@userId, @platformName, @username, @encryptedPassword, @url, @encryptedNotes)
`);
const updateStmt = db.prepare(`
    UPDATE vault_entries
    SET platform_name = @platformName, username = @username, encrypted_password = @encryptedPassword,
        url = @url, encrypted_notes = @encryptedNotes,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = @id AND user_id = @userId
`);
const deleteStmt = db.prepare('DELETE FROM vault_entries WHERE id = ? AND user_id = ?');

function toPublicEntry(row, dek) {
    return {
        id: row.id,
        platformName: row.platform_name,
        username: row.username,
        password: decryptField(row.encrypted_password, dek),
        url: row.url,
        notes: row.encrypted_notes ? decryptField(row.encrypted_notes, dek) : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function listEntries(userId, dek) {
    return listStmt.all(userId).map((row) => toPublicEntry(row, dek));
}

export function getEntry(userId, id, dek) {
    const row = getStmt.get(id, userId);
    return row ? toPublicEntry(row, dek) : null;
}

export function createEntry(userId, dek, { platformName, username, password, url, notes }) {
    const info = insertStmt.run({
        userId,
        platformName,
        username,
        encryptedPassword: encryptField(password, dek),
        url: url || null,
        encryptedNotes: notes ? encryptField(notes, dek) : null,
    });
    return getEntry(userId, info.lastInsertRowid, dek);
}

export function updateEntry(userId, id, dek, { platformName, username, password, url, notes }) {
    const existing = getStmt.get(id, userId);
    if (!existing) return null;

    updateStmt.run({
        id,
        userId,
        platformName,
        username,
        encryptedPassword: encryptField(password, dek),
        url: url || null,
        encryptedNotes: notes ? encryptField(notes, dek) : null,
    });
    return getEntry(userId, id, dek);
}

export function deleteEntry(userId, id) {
    const info = deleteStmt.run(id, userId);
    return info.changes > 0;
}
