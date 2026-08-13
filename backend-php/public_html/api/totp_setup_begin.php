<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('POST');
$userId = pk_require_auth();
pk_verify_csrf();

$db = pk_db();
pk_rate_limit_endpoint($db, $pkConfig, 'change_password', 'user:' . $userId);

// Generates a fresh secret and holds it ONLY in the session, not the
// database - an abandoned setup (never confirmed) leaves no trace at all.
// It's written to `users` for real only by totp_setup_confirm.php, once the
// user has proven they actually scanned/entered it correctly.
$rawSecret = pk_totp_generate_secret();
$_SESSION['pending_totp_secret'] = base64_encode($rawSecret);

$email = pk_current_email();
$otpauthUri = pk_totp_provisioning_uri($rawSecret, $email, 'Pass Keeper');

pk_json_response([
    'secret'     => pk_base32_encode($rawSecret),
    'otpauthUri' => $otpauthUri,
]);
