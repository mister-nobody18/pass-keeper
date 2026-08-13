<?php

declare(strict_types=1);

/**
 * TOTP (RFC 6238, built on HOTP/RFC 4226) — 30-second step, 6 digits,
 * SHA-1 (the algorithm Google Authenticator and virtually every other TOTP
 * app defaults to and, for some, the only one supported). Built entirely on
 * PHP's own hash_hmac() - not a hand-rolled cryptographic primitive, just
 * the standardized truncation/verification construction on top of one,
 * same reasoning CONTRIBUTING.md already applies to HKDF/AES-GCM on the
 * frontend: don't hand-roll a primitive the platform provides, but the
 * public algorithm built on top of it is fair game.
 *
 * The TOTP secret is the one deliberate exception to "the server never
 * holds anything sensitive readably" (see docs/ARCHITECTURE.md §7): the
 * server must be able to compute/verify a live 6-digit code, which is
 * fundamentally impossible from a one-way hash. It is instead encrypted at
 * rest with AES-256-GCM, keyed by a value derived from the existing server
 * pepper (domain-separated via HMAC, not the pepper itself) - encrypted,
 * not plaintext, and never transmitted again after the one-time setup
 * screen.
 */

const PK_TOTP_DIGITS = 6;
const PK_TOTP_STEP_SECONDS = 30;
const PK_TOTP_SECRET_BYTES = 20; // 160 bits - RFC 4226's recommended minimum
const PK_TOTP_ENVELOPE_VERSION = 1;

const PK_BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function pk_base32_encode(string $bytes): string
{
    $bits = '';
    foreach (str_split($bytes) as $byte) {
        $bits .= str_pad(decbin(ord($byte)), 8, '0', STR_PAD_LEFT);
    }
    $output = '';
    foreach (str_split($bits, 5) as $chunk) {
        $chunk = str_pad($chunk, 5, '0', STR_PAD_RIGHT);
        $output .= PK_BASE32_ALPHABET[bindec($chunk)];
    }
    return $output;
}

function pk_base32_decode(string $encoded): string
{
    $bits = '';
    foreach (str_split(strtoupper($encoded)) as $char) {
        $index = strpos(PK_BASE32_ALPHABET, $char);
        if ($index === false) {
            continue; // tolerate stray separators/padding, same spirit as recoveryKey.js's parser
        }
        $bits .= str_pad(decbin($index), 5, '0', STR_PAD_LEFT);
    }
    $bytes = '';
    foreach (str_split($bits, 8) as $byteBits) {
        if (strlen($byteBits) < 8) {
            break; // trailing partial byte from padding bits, not real data
        }
        $bytes .= chr(bindec($byteBits));
    }
    return $bytes;
}

/** Generates a fresh random TOTP secret, raw bytes. */
function pk_totp_generate_secret(): string
{
    return random_bytes(PK_TOTP_SECRET_BYTES);
}

/**
 * The otpauth:// URI Google Authenticator (and every other TOTP app) reads
 * to enroll — either scanned as a QR code or, since it's just a URI, usable
 * to reconstruct the same QR anywhere. $accountEmail identifies the account
 * within the app; $issuer ("Pass Keeper") groups it visually.
 */
function pk_totp_provisioning_uri(string $rawSecret, string $accountEmail, string $issuer): string
{
    // rawurlencode() per parameter (RFC 3986 %-encoding, spaces as %20), not
    // http_build_query()'s default application/x-www-form-urlencoded style
    // (spaces as '+') - a query string isn't form data, and some
    // authenticator apps display the raw '+' instead of treating it as a
    // space, showing "Pass+Keeper" instead of "Pass Keeper".
    $label = rawurlencode($issuer) . ':' . rawurlencode($accountEmail);
    $secret = pk_base32_encode($rawSecret);
    $params = [
        'secret'    => $secret,
        'issuer'    => $issuer,
        'algorithm' => 'SHA1',
        'digits'    => (string) PK_TOTP_DIGITS,
        'period'    => (string) PK_TOTP_STEP_SECONDS,
    ];
    $query = implode('&', array_map(
        fn($key, $value) => rawurlencode($key) . '=' . rawurlencode($value),
        array_keys($params),
        array_values($params)
    ));
    return 'otpauth://totp/' . $label . '?' . $query;
}

/** RFC 4226 HOTP over the given counter value. */
function pk_hotp_code(string $rawSecret, int $counter): string
{
    $counterBytes = pack('N*', 0, $counter); // 8-byte big-endian counter (pack('N*',0,x) = high 4 bytes zero, low 4 bytes x)
    $hash = hash_hmac('sha1', $counterBytes, $rawSecret, true);

    $offset = ord($hash[19]) & 0x0F;
    $truncated = ((ord($hash[$offset]) & 0x7F) << 24)
        | ((ord($hash[$offset + 1]) & 0xFF) << 16)
        | ((ord($hash[$offset + 2]) & 0xFF) << 8)
        | (ord($hash[$offset + 3]) & 0xFF);

    $code = $truncated % (10 ** PK_TOTP_DIGITS);
    return str_pad((string) $code, PK_TOTP_DIGITS, '0', STR_PAD_LEFT);
}

/**
 * Verifies a user-entered code against the current time, tolerating ±1 step
 * (90 seconds total) for clock drift between the server and the user's
 * phone — standard practice for TOTP verification. Constant-time compare
 * per candidate to avoid leaking which step (if any) matched via timing.
 */
function pk_totp_verify(string $rawSecret, string $code): bool
{
    if (!ctype_digit($code) || strlen($code) !== PK_TOTP_DIGITS) {
        return false;
    }

    $currentStep = intdiv(time(), PK_TOTP_STEP_SECONDS);
    foreach ([-1, 0, 1] as $drift) {
        if (hash_equals(pk_hotp_code($rawSecret, $currentStep + $drift), $code)) {
            return true;
        }
    }
    return false;
}

function pk_totp_encryption_key(string $pepper): string
{
    return hash_hmac('sha256', 'totp-secret-encryption-v1', $pepper, true);
}

/** Encrypts a raw TOTP secret for storage — same {v,iv,data} envelope shape crypto/dek.js uses client-side. */
function pk_totp_encrypt_secret(string $rawSecret, string $pepper): string
{
    $key = pk_totp_encryption_key($pepper);
    $iv = random_bytes(12);
    $tag = '';
    $ciphertext = openssl_encrypt($rawSecret, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);

    if ($ciphertext === false) {
        error_log('Pass Keeper: TOTP secret encryption failed.');
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Internal server error.']);
        exit;
    }

    return json_encode([
        'v'    => PK_TOTP_ENVELOPE_VERSION,
        'iv'   => base64_encode($iv),
        'data' => base64_encode($ciphertext . $tag),
    ], JSON_UNESCAPED_SLASHES);
}

/** Decrypts a stored TOTP secret envelope back to raw bytes, or null if it's malformed/tampered. */
function pk_totp_decrypt_secret(string $envelopeJson, string $pepper): ?string
{
    $envelope = json_decode($envelopeJson, true);
    if (
        !is_array($envelope)
        || ($envelope['v'] ?? null) !== PK_TOTP_ENVELOPE_VERSION
        || !is_string($envelope['iv'] ?? null)
        || !is_string($envelope['data'] ?? null)
    ) {
        return null;
    }

    $iv = base64_decode($envelope['iv'], true);
    $combined = base64_decode($envelope['data'], true);
    if ($iv === false || $combined === false || strlen($combined) < 16) {
        return null;
    }

    $ciphertext = substr($combined, 0, -16);
    $tag = substr($combined, -16);
    $key = pk_totp_encryption_key($pepper);

    $plaintext = openssl_decrypt($ciphertext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    return $plaintext === false ? null : $plaintext;
}

const PK_TRUSTED_DEVICE_COOKIE = 'pk_trusted_device';
const PK_TRUSTED_DEVICE_DAYS = 30;

/**
 * Decides whether login.php/password_reset_confirm.php should challenge for
 * a TOTP code before completing a login, or skip straight to
 * pk_complete_login() as if 2FA weren't enabled at all. Three ways to skip:
 *
 *   1. 2FA isn't enabled for this account at all.
 *   2. A session already authenticated as this exact user exists - this is
 *      what makes VaultLockContext's idle-unlock (which re-calls login.php
 *      on every re-entry, but only while a valid session for that same user
 *      is already live) never re-prompt for a code. Only establishing a
 *      genuinely NEW session (fresh browser session, another device, after
 *      an explicit logout) triggers the gate.
 *   3. The pk_trusted_device cookie hashes to a live, matching row.
 */
function pk_totp_challenge_needed(PDO $db, array $user): bool
{
    if ($user['totp_enabled_at'] === null) {
        return false;
    }

    if (pk_current_user_id() === (int) $user['id']) {
        return false;
    }

    $token = $_COOKIE[PK_TRUSTED_DEVICE_COOKIE] ?? null;
    if (is_string($token) && $token !== '') {
        $stmt = $db->prepare(
            'SELECT id FROM trusted_devices WHERE user_id = :user_id AND token_hash = :token_hash AND expires_at > NOW()'
        );
        $stmt->execute(['user_id' => (int) $user['id'], 'token_hash' => hash('sha256', $token)]);
        if ($stmt->fetch() !== false) {
            return false;
        }
    }

    return true;
}

/** Marks a session as having proven the password but not yet the TOTP code — see api/totp_verify.php. */
function pk_start_pending_totp(int $userId): void
{
    $_SESSION['pending_2fa_user_id'] = $userId;
    $_SESSION['pending_2fa_started_at'] = time();
}

/** 5-minute window to actually enter the code — a stale pending state can't be resurrected. */
function pk_pending_totp_user_id(int $maxAgeSeconds = 300): ?int
{
    $userId = $_SESSION['pending_2fa_user_id'] ?? null;
    $startedAt = $_SESSION['pending_2fa_started_at'] ?? null;

    if ($userId === null || $startedAt === null || (time() - (int) $startedAt) > $maxAgeSeconds) {
        unset($_SESSION['pending_2fa_user_id'], $_SESSION['pending_2fa_started_at']);
        return null;
    }

    return (int) $userId;
}

function pk_clear_pending_totp(): void
{
    unset($_SESSION['pending_2fa_user_id'], $_SESSION['pending_2fa_started_at']);
}

/** Generates and stores a new trusted-device token, and sets the cookie the browser will send back. */
function pk_issue_trusted_device(PDO $db, array $config, int $userId): void
{
    $token = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', time() + PK_TRUSTED_DEVICE_DAYS * 86400);

    $insert = $db->prepare(
        'INSERT INTO trusted_devices (user_id, token_hash, expires_at) VALUES (:user_id, :token_hash, :expires_at)'
    );
    $insert->execute(['user_id' => $userId, 'token_hash' => hash('sha256', $token), 'expires_at' => $expiresAt]);

    setcookie(PK_TRUSTED_DEVICE_COOKIE, $token, [
        'expires'  => time() + PK_TRUSTED_DEVICE_DAYS * 86400,
        'path'     => '/',
        'domain'   => '',
        'secure'   => pk_is_production($config),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function pk_clear_trusted_device_cookie(array $config): void
{
    setcookie(PK_TRUSTED_DEVICE_COOKIE, '', [
        'expires'  => time() - 42000,
        'path'     => '/',
        'domain'   => '',
        'secure'   => pk_is_production($config),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}
