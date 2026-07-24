<?php

declare(strict_types=1);

/**
 * The server never sees a master password or an encryption key. What it
 * receives is `authHash`: the output of the browser's own Argon2id + HKDF
 * (see docs/ARCHITECTURE.md §1). Everything in this file operates on that
 * value only — it is opaque, high-entropy, and unrelated to the vault's
 * encryption key by construction (HKDF's whole job is making those two
 * outputs independent).
 */

const PK_ARGON2ID_OPTIONS = [
    'memory_cost' => 65536, // 64 MB
    'time_cost'   => 4,
    'threads'     => 1,
];

function pk_assert_argon2id_available(): void
{
    if (!defined('PASSWORD_ARGON2ID')) {
        error_log('Pass Keeper: PHP was not built with Argon2id support (PASSWORD_ARGON2ID unavailable).');
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Server misconfiguration.']);
        exit;
    }
}

/**
 * Hashes the client-supplied auth hash for storage, with the server-side
 * pepper mixed in first. This is a second, independent slow-hash pass on
 * top of the browser's own Argon2id — not redundant, because `authHash`
 * is itself a bearer login credential. Without this step, a stolen
 * `users` table would hand over directly-replayable login credentials;
 * with it, an attacker still has to invert Argon2id. It does NOT add
 * protection to vault confidentiality itself — see docs/THREAT-MODEL.md §2.2.
 */
function pk_hash_auth_value(string $authHash, string $pepper): string
{
    pk_assert_argon2id_available();

    $peppered = $pepper . ':' . $authHash;
    $hash = password_hash($peppered, PASSWORD_ARGON2ID, PK_ARGON2ID_OPTIONS);

    if ($hash === false) {
        error_log('Pass Keeper: password_hash() failed.');
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Internal server error.']);
        exit;
    }

    return $hash;
}

function pk_verify_auth_value(string $authHash, string $pepper, string $storedHash): bool
{
    pk_assert_argon2id_available();
    $peppered = $pepper . ':' . $authHash;
    return password_verify($peppered, $storedHash);
}

/**
 * Burns roughly the same amount of CPU time as a real password_verify()
 * call (one Argon2id computation), so the "email not found" path on login
 * takes about as long as the "email found, hash mismatched" path. Used
 * instead of a real verify because there's no stored hash to check
 * against when the account doesn't exist. See docs/THREAT-MODEL.md on
 * login-enumeration timing.
 */
function pk_burn_argon2id_time(): void
{
    pk_assert_argon2id_available();
    password_hash('pass-keeper-dummy-value-for-timing', PASSWORD_ARGON2ID, PK_ARGON2ID_OPTIONS);
}

/**
 * Deterministic "fake" KDF salt for a login-salt lookup on an email that
 * doesn't exist, so the response is indistinguishable in shape and
 * value-stability from a real user's (the same nonexistent email always
 * yields the same fake salt, rather than a fresh random one on every call,
 * which would itself be a distinguishing signal). Never stored; derived
 * from the pepper so it can't be predicted or reproduced without it.
 */
function pk_fake_kdf_salt(string $email, string $pepper): string
{
    return base64_encode(hash_hmac('sha256', strtolower(trim($email)), $pepper, true));
}
