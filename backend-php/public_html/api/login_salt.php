<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('GET');

$db = pk_db();
// Counts against the same bucket as login.php itself, so this lookup step
// can't be used to bypass login's rate limit.
pk_rate_limit_endpoint($db, $pkConfig, 'login', pk_client_ip());

$email = isset($_GET['email']) && is_string($_GET['email']) ? strtolower(trim($_GET['email'])) : '';

if (!pk_valid_email($email)) {
    pk_error_response('A valid email is required.', 400);
}

$stmt = $db->prepare('SELECT kdf_salt, kdf_params FROM users WHERE email = :email');
$stmt->execute(['email' => $email]);
$row = $stmt->fetch();

if ($row !== false) {
    pk_json_response([
        'kdfSalt'   => $row['kdf_salt'],
        'kdfParams' => $row['kdf_params'],
    ]);
}

// Email not found: return a deterministic, plausible-looking fake salt and
// the standard params instead of a 404, so this endpoint can't be used to
// enumerate accounts by response shape, status code, or value instability
// across repeated calls. See docs/THREAT-MODEL.md.
pk_json_response([
    'kdfSalt'   => pk_fake_kdf_salt($email, $pkConfig['pepper']),
    'kdfParams' => $pkConfig['fake_kdf_params'],
]);
