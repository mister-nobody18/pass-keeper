-- Migration: TOTP two-factor authentication + trusted_devices table.
--
-- Run this ONCE against an EXISTING production database that predates the
-- 2FA feature - i.e. one whose `users` table does not yet have
-- `totp_secret_encrypted`. Do NOT run this against a fresh install;
-- backend-php/schema.sql already creates every column/table below.
--
-- IMPORTANT (learned the hard way deploying migrations/001_add_dek_columns.sql):
-- run this from INSIDE the target database in phpMyAdmin - click the
-- database name in the left sidebar first so it's actually selected, THEN
-- use its Import tab. Running this from the server-level Import page (the
-- one reachable without clicking into a specific database first) fails with
-- "#1046 - No database selected" even though it may still report some
-- queries as "successfully executed" - always verify via the Structure tab
-- afterward, don't trust the summary message alone.
--
-- Before running this against real data:
--   1. Take a fresh backup (see docs/DEPLOYMENT.md §4).
--   2. Confirm via phpMyAdmin's Structure tab that `users` does NOT already
--      have a `totp_secret_encrypted` column - re-running ADD COLUMN
--      against a column that already exists will error out (this file is
--      not re-runnable, unlike schema.sql's CREATE TABLE IF NOT EXISTS).
--
-- After running this, every existing account's totp_secret_encrypted and
-- totp_enabled_at are NULL - meaning 2FA is off, exactly as it was before
-- this migration. Nothing else needs to happen for existing accounts; 2FA
-- is opt-in per account via Settings.

ALTER TABLE users
    ADD COLUMN totp_secret_encrypted TEXT NULL     AFTER recovery_key_created_at,
    ADD COLUMN totp_enabled_at       DATETIME NULL AFTER totp_secret_encrypted;

CREATE TABLE IF NOT EXISTS trusted_devices (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT UNSIGNED NOT NULL,
    token_hash   CHAR(64) NOT NULL,
    expires_at   DATETIME NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_trusted_devices_token_hash (token_hash),
    KEY idx_trusted_devices_user_id (user_id),
    KEY idx_trusted_devices_expires_at (expires_at),
    CONSTRAINT fk_trusted_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
