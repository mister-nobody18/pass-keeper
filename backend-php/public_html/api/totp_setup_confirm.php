<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('POST');
$userId = pk_require_auth();
pk_verify_csrf();

$db = pk_db();
pk_rate_limit_endpoint($db, $pkConfig, 'totp_verify', 'user:' . $userId);

$body = pk_read_json_body();
$code = $body['code'] ?? null;

if (!pk_valid_string($code, 6, 6) || !ctype_digit($code)) {
    pk_error_response('A valid 6-digit code is required.', 400);
}

$pendingSecretB64 = $_SESSION['pending_totp_secret'] ?? null;
if ($pendingSecretB64 === null) {
    pk_error_response('No pending 2FA setup found. Start over.', 400);
}
$rawSecret = base64_decode($pendingSecretB64, true);

if ($rawSecret === false || !pk_totp_verify($rawSecret, $code)) {
    pk_error_response('That code is incorrect. Check your authenticator app and try again.', 403);
}

$encryptedSecret = pk_totp_encrypt_secret($rawSecret, $pkConfig['pepper']);

$update = $db->prepare(
    'UPDATE users SET totp_secret_encrypted = :secret, totp_enabled_at = NOW() WHERE id = :id'
);
$update->execute(['secret' => $encryptedSecret, 'id' => $userId]);

unset($_SESSION['pending_totp_secret']);

$stmt = $db->prepare('SELECT totp_enabled_at FROM users WHERE id = :id');
$stmt->execute(['id' => $userId]);
$row = $stmt->fetch();

pk_json_response(['enabledAt' => $row['totp_enabled_at']]);
