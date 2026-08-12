-- Pass Keeper — PHP/MySQL schema.
--
-- Run this once against a fresh database before deploying the PHP backend
-- (e.g. via DirectAdmin's phpMyAdmin). See docs/ARCHITECTURE.md for the full
-- design reasoning behind each table.
--
-- Deviation from the original docs/ARCHITECTURE.md draft: there is no
-- `sessions` table here. This implementation uses PHP's native session
-- mechanism (file-based, per docs in CONTRIBUTING.md) instead of a
-- custom DB-backed session store. See CONTRIBUTING.md for what that
-- trades away (centralized cross-device session revocation) and how to
-- reintroduce a sessions table later if that's needed.

CREATE TABLE IF NOT EXISTS users (
    id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email                    VARCHAR(255) NOT NULL,
    auth_hash                VARCHAR(255) NOT NULL,      -- password_hash(pepper . ':' . clientAuthHash, PASSWORD_ARGON2ID)
    kdf_salt                 VARCHAR(255) NOT NULL,      -- opaque to the server; used only by the browser's Argon2id
    kdf_params                VARCHAR(255) NOT NULL,      -- opaque to the server; e.g. '{"memory":65536,"iterations":3,"parallelism":1}'
    wrapped_dek_password     TEXT NOT NULL,               -- opaque: the vault's DEK, AES-GCM-wrapped by a key derived from the master password
    wrapped_dek_recovery     TEXT NULL,                   -- opaque: the SAME DEK, wrapped by a key derived from the recovery key — NULL until one is set up
    recovery_key_created_at  DATETIME NULL,               -- when wrapped_dek_recovery was last set/rotated; NULL if never set up
    failed_attempts          SMALLINT UNSIGNED NOT NULL DEFAULT 0,  -- reserved for future use, not enforced yet — see CONTRIBUTING.md
    locked_until             DATETIME NULL,                          -- reserved for future use, not enforced yet
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vaults (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT UNSIGNED NOT NULL,
    ciphertext      LONGTEXT NOT NULL,           -- opaque AES-256-GCM envelope, encrypted under the account's DEK — the server never parses this
    schema_version  SMALLINT UNSIGNED NOT NULL DEFAULT 1,  -- shape of the DECRYPTED blob's JSON, client-defined
    revision        INT UNSIGNED NOT NULL DEFAULT 1,        -- optimistic-concurrency token — see docs/ARCHITECTURE.md §3
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_vaults_user_id (user_id),
    CONSTRAINT fk_vaults_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rate_limits (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    bucket_key      VARCHAR(255) NOT NULL,       -- e.g. 'register:203.0.113.4' or 'login:email:<sha256>'
    window_start    DATETIME NOT NULL,           -- request time floored to the bucket's window size
    attempt_count   INT UNSIGNED NOT NULL DEFAULT 1,

    UNIQUE KEY uq_rate_limits_bucket (bucket_key, window_start),
    KEY idx_rate_limits_window_start (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Master-password reset tokens. The raw token only ever exists client-side
-- and in the emailed link — only its SHA-256 hash is stored, the same
-- reasoning as never storing a raw password or session token (see
-- docs/ARCHITECTURE.md §6 and lib/password_reset.php). A row is consumed
-- exactly once, atomically, via an UPDATE ... WHERE used_at IS NULL guard —
-- see pk_consume_reset_token() — not by a separate SELECT-then-UPDATE.
CREATE TABLE IF NOT EXISTS password_resets (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT UNSIGNED NOT NULL,
    token_hash   CHAR(64) NOT NULL,              -- SHA-256 hex of the raw token
    expires_at   DATETIME NOT NULL,
    used_at      DATETIME NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_password_resets_token_hash (token_hash),
    KEY idx_password_resets_user_id (user_id),
    KEY idx_password_resets_expires_at (expires_at),
    CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
