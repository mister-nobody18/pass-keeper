-- Pass Keeper database schema (SQLite)

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,       -- argon2id hash used for login verification
    kdf_salt        TEXT NOT NULL,       -- base64 salt used to derive the KEK from the master password
    wrapped_dek     TEXT NOT NULL,       -- the vault Data Encryption Key, encrypted with the KEK (AES-256-GCM)
    two_fa_enabled  INTEGER NOT NULL DEFAULT 0,
    two_fa_secret   TEXT,                -- reserved for future TOTP secret storage (unused for now)
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS vault_entries (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform_name       TEXT NOT NULL,
    username            TEXT NOT NULL,
    encrypted_password  TEXT NOT NULL,   -- AES-256-GCM ciphertext, format "iv.tag.ciphertext" (base64url segments)
    url                 TEXT,
    encrypted_notes     TEXT,            -- same format as encrypted_password, nullable
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_vault_entries_user_id ON vault_entries(user_id);
