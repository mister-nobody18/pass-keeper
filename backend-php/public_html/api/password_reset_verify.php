<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('GET');

$db = pk_db();
pk_rate_limit_endpoint($db, $pkConfig, 'password_reset_verify', pk_client_ip());

$token = isset($_GET['token']) && is_string($_GET['token']) ? $_GET['token'] : '';

if (!pk_valid_string($token, 32, 128)) {
    pk_json_response(['valid' => false]);
}

$claim = pk_lookup_reset_token($db, $token);
if ($claim === null) {
    pk_json_response(['valid' => false]);
}

$stmt = $db->prepare('SELECT wrapped_dek_recovery FROM users WHERE id = :id');
$stmt->execute(['id' => $claim['user_id']]);
$user = $stmt->fetch();

pk_json_response([
    'valid'              => true,
    'email'              => $claim['email'],
    'wrappedDekRecovery' => $user['wrapped_dek_recovery'] ?? null,
]);
