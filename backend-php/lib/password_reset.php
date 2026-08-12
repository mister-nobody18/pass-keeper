<?php

declare(strict_types=1);

/**
 * Password-reset token lifecycle. The raw token exists only client-side and
 * in the emailed link — only its SHA-256 hash is ever stored, the same
 * reasoning as never storing a raw password or a raw session identifier.
 */

/** 32 random bytes, hex-encoded (64 chars) — 256 bits, not brute-forceable. */
function pk_generate_reset_token(): string
{
    return bin2hex(random_bytes(32));
}

function pk_hash_reset_token(string $token): string
{
    return hash('sha256', $token);
}

/**
 * Invalidates any prior unused tokens for this user (only one active reset
 * link at a time) and creates a fresh one. Returns the RAW token — the only
 * place it's ever available outside the user's own inbox.
 */
function pk_create_reset_token(PDO $db, int $userId, int $expiryMinutes): string
{
    $expire = $db->prepare(
        'UPDATE password_resets SET used_at = NOW() WHERE user_id = :user_id AND used_at IS NULL'
    );
    $expire->execute(['user_id' => $userId]);

    $token = pk_generate_reset_token();

    $insert = $db->prepare(
        'INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES (:user_id, :token_hash, DATE_ADD(NOW(), INTERVAL :minutes MINUTE))'
    );
    $insert->execute([
        'user_id'    => $userId,
        'token_hash' => pk_hash_reset_token($token),
        'minutes'    => $expiryMinutes,
    ]);

    return $token;
}

/**
 * Looks up a token WITHOUT consuming it — used by the verify step, which
 * may be called more than once (e.g. the user reloads the reset page)
 * before they actually submit a new password.
 *
 * @return array{id:int, user_id:int, email:string}|null
 */
function pk_lookup_reset_token(PDO $db, string $token): ?array
{
    $stmt = $db->prepare(
        'SELECT pr.id, pr.user_id, u.email
         FROM password_resets pr
         JOIN users u ON u.id = pr.user_id
         WHERE pr.token_hash = :token_hash AND pr.used_at IS NULL AND pr.expires_at > NOW()'
    );
    $stmt->execute(['token_hash' => pk_hash_reset_token($token)]);
    $row = $stmt->fetch();
    return $row === false ? null : ['id' => (int) $row['id'], 'user_id' => (int) $row['user_id'], 'email' => $row['email']];
}

/**
 * Atomically claims a token so it can never be used twice, even by two
 * concurrent requests racing on the same token — mirrors vault.php's
 * optimistic-concurrency pattern (a single UPDATE with a guard clause,
 * checked via rowCount(), not a SELECT-then-UPDATE).
 *
 * @return int|null the user_id the token belonged to, or null if it was
 *   already invalid/expired/used by the time this ran
 */
function pk_consume_reset_token(PDO $db, string $token): ?int
{
    $tokenHash = pk_hash_reset_token($token);

    $lookup = $db->prepare(
        'SELECT user_id FROM password_resets WHERE token_hash = :token_hash AND used_at IS NULL AND expires_at > NOW()'
    );
    $lookup->execute(['token_hash' => $tokenHash]);
    $row = $lookup->fetch();
    if ($row === false) {
        return null;
    }

    $claim = $db->prepare(
        'UPDATE password_resets SET used_at = NOW() WHERE token_hash = :token_hash AND used_at IS NULL AND expires_at > NOW()'
    );
    $claim->execute(['token_hash' => $tokenHash]);

    return $claim->rowCount() === 1 ? (int) $row['user_id'] : null;
}
