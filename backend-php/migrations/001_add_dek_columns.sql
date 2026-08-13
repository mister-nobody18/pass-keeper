-- Migration: envelope-encryption (DEK) columns + password_resets table.
--
-- Run this ONCE against an EXISTING production database that predates the
-- master-password-reset feature - i.e. one whose `users` table does not yet
-- have `wrapped_dek_password`. Do NOT run this against a fresh install;
-- backend-php/schema.sql already creates every column/table below and is
-- the source of truth for new installs.
--
-- Before running this against real data:
--   1. Take a fresh backup (see docs/DEPLOYMENT.md §4).
--   2. Confirm via phpMyAdmin's Structure tab that `users` does NOT already
--      have a `wrapped_dek_password` column - re-running ADD COLUMN against
--      a column that already exists will error out (this file is not
--      re-runnable, unlike schema.sql's CREATE TABLE IF NOT EXISTS).
--
-- After running this, every existing account's `wrapped_dek_password` is
-- NULL - a real, meaningful state meaning "hasn't migrated to the DEK model
-- yet." Each such account transparently migrates itself on its own next
-- successful login (frontend/src/crypto/legacyMigration.js) - there is
-- nothing further to do here for existing accounts' data. See
-- docs/DEPLOYMENT.md's "Upgrading an existing production database" section.

ALTER TABLE users
    ADD COLUMN wrapped_dek_password    TEXT NULL     AFTER kdf_params,
    ADD COLUMN wrapped_dek_recovery    TEXT NULL     AFTER wrapped_dek_password,
    ADD COLUMN recovery_key_created_at DATETIME NULL AFTER wrapped_dek_recovery;

CREATE TABLE IF NOT EXISTS password_resets (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT UNSIGNED NOT NULL,
    token_hash   CHAR(64) NOT NULL,
    expires_at   DATETIME NOT NULL,
    used_at      DATETIME NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_password_resets_token_hash (token_hash),
    KEY idx_password_resets_user_id (user_id),
    KEY idx_password_resets_expires_at (expires_at),
    CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
