<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('POST');

$db = pk_db();

// IP-based limit applies even to malformed requests, so a request crafted
// to fail validation can't be used to dodge rate limiting.
pk_rate_limit_endpoint($db, $pkConfig, 'login', pk_client_ip());

$body = pk_read_json_body();
$email    = is_string($body['email'] ?? null) ? strtolower(trim($body['email'])) : '';
$authHash = $body['authHash'] ?? null;

if (!pk_valid_email($email) || !pk_valid_string($authHash, 16, 512)) {
    pk_error_response('Email and auth hash are required.', 400);
}

// Additionally rate-limit per account, so a botnet spreading attempts
// across many IPs can't bypass the IP-based limit for one target account.
pk_rate_limit_endpoint($db, $pkConfig, 'login', 'email:' . hash('sha256', $email));

$stmt = $db->prepare(
    'SELECT id, email, auth_hash, wrapped_dek_password, recovery_key_created_at, totp_enabled_at
     FROM users WHERE email = :email'
);
$stmt->execute(['email' => $email]);
$user = $stmt->fetch();

if ($user === false) {
    // No such account: burn comparable time to a real verification, then
    // return the exact same error as a wrong password below. Never reveal
    // which case occurred.
    pk_burn_argon2id_time();
    pk_error_response('Invalid email or password.', 401);
}

if (!pk_verify_auth_value($authHash, $pkConfig['pepper'], $user['auth_hash'])) {
    pk_error_response('Invalid email or password.', 401);
}

// See lib/totp.php: skipped entirely for an idle-unlock re-entry (a session
// already authenticated as this same user), an account with 2FA off, or a
// live trusted-device cookie. Otherwise the password alone isn't enough to
// finish logging in yet.
if (pk_totp_challenge_needed($db, $user)) {
    pk_start_pending_totp((int) $user['id']);
    pk_json_response(['twoFactorRequired' => true]);
}

pk_complete_login($user, $pkConfig);
