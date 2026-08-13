<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('POST');

$db = pk_db();

// The user isn't authenticated yet at this point (pk_require_auth() would
// reject them) - the ONLY thing proving they're mid-login is the pending-2FA
// session state login.php/password_reset_confirm.php set after verifying
// the password. Without that, there's nothing to verify a code against.
$userId = pk_pending_totp_user_id();
if ($userId === null) {
    pk_error_response('No pending sign-in found. Please sign in again.', 400);
}

// Rate-limited by the pending user id, not IP - same reasoning
// change_password.php/recovery_key.php use: this already required proving
// the password first, so the id isn't attacker-controlled, and a 6-digit
// code has far less entropy than a password, so this needs to be tight.
pk_rate_limit_endpoint($db, $pkConfig, 'totp_verify', 'user:' . $userId);

$body = pk_read_json_body();
$code = $body['code'] ?? null;
$rememberDevice = ($body['rememberDevice'] ?? false) === true;

if (!pk_valid_string($code, 6, 6) || !ctype_digit($code)) {
    pk_error_response('A valid 6-digit code is required.', 400);
}

$stmt = $db->prepare(
    'SELECT id, email, wrapped_dek_password, recovery_key_created_at, totp_secret_encrypted, totp_enabled_at
     FROM users WHERE id = :id'
);
$stmt->execute(['id' => $userId]);
$user = $stmt->fetch();

if ($user === false || $user['totp_secret_encrypted'] === null) {
    // Should not happen (2FA was enabled when the pending state was set),
    // but fail closed and don't leak which case occurred.
    pk_clear_pending_totp();
    pk_error_response('Invalid code.', 401);
}

$rawSecret = pk_totp_decrypt_secret($user['totp_secret_encrypted'], $pkConfig['pepper']);
if ($rawSecret === null || !pk_totp_verify($rawSecret, $code)) {
    pk_error_response('That code is incorrect.', 401);
}

pk_clear_pending_totp();

if ($rememberDevice) {
    pk_issue_trusted_device($db, $pkConfig, (int) $user['id']);
}

pk_complete_login($user, $pkConfig);
