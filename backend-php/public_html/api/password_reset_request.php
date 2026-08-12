<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('POST');

$db = pk_db();
// IP-based limit applies even to malformed requests, so a request crafted
// to fail validation can't be used to dodge rate limiting - same reasoning
// as login.php.
pk_rate_limit_endpoint($db, $pkConfig, 'password_reset_request', pk_client_ip());

$body = pk_read_json_body();
$email = is_string($body['email'] ?? null) ? strtolower(trim($body['email'])) : '';

if (!pk_valid_email($email)) {
    pk_error_response('A valid email is required.', 400);
}

// Also rate-limited per account, independent of IP - this is a realistic
// email-bombing vector (anyone can type someone else's address) that IP
// limiting alone doesn't stop.
pk_rate_limit_endpoint($db, $pkConfig, 'password_reset_request', 'email:' . hash('sha256', $email));

$stmt = $db->prepare('SELECT id FROM users WHERE email = :email');
$stmt->execute(['email' => $email]);
$user = $stmt->fetch();

// Always the same response, whether or not the account exists - this
// endpoint is not a place to leak account existence any more than
// login.php is. See docs/THREAT-MODEL.md.
if ($user !== false) {
    $expiryMinutes = $pkConfig['password_reset']['expiry_minutes'] ?? 10;
    $token = pk_create_reset_token($db, (int) $user['id'], $expiryMinutes);
    $resetUrl = rtrim($pkConfig['app_url'], '/') . '/reset-password?token=' . urlencode($token);

    if (!pk_send_password_reset_email($pkConfig, $email, $resetUrl, $expiryMinutes)) {
        error_log('Pass Keeper: failed to send password reset email to a valid recipient (mail() returned false).');
    }
}

pk_json_response(['message' => 'If an account exists for that email, a password reset link has been sent.']);
