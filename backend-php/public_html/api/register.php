<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('POST');

$db = pk_db();
pk_rate_limit_endpoint($db, $pkConfig, 'register', pk_client_ip());

$body = pk_read_json_body();

$email                  = is_string($body['email'] ?? null) ? trim($body['email']) : '';
$authHash               = $body['authHash'] ?? null;
$kdfSalt                = $body['kdfSalt'] ?? null;
$kdfParams              = $body['kdfParams'] ?? null;
$wrappedDekPassword     = $body['wrappedDekPassword'] ?? null;
$wrappedDekRecovery     = $body['wrappedDekRecovery'] ?? null; // optional - recovery key setup is skippable at registration
$vaultBlob              = $body['vaultCiphertext'] ?? null;

if (!pk_valid_email($email)) {
    pk_error_response('A valid email is required.', 400);
}
if (!pk_valid_string($authHash, 16, 512)) {
    pk_error_response('A valid auth hash is required.', 400);
}
if (!pk_valid_string($kdfSalt, 8, 512)) {
    pk_error_response('A valid KDF salt is required.', 400);
}
if (!pk_valid_string($kdfParams, 2, 512)) {
    pk_error_response('Valid KDF parameters are required.', 400);
}
if (!pk_valid_string($wrappedDekPassword, 1, 5000)) {
    pk_error_response('A valid wrapped key is required.', 400);
}
if ($wrappedDekRecovery !== null && !pk_valid_string($wrappedDekRecovery, 1, 5000)) {
    pk_error_response('Invalid recovery wrap.', 400);
}
if (!pk_valid_string($vaultBlob, 1, 5_000_000)) {
    pk_error_response('A valid initial vault is required.', 400);
}

$email = strtolower($email);

// Fast-path existence check for a friendlier error on the common case.
// The UNIQUE KEY on users.email is the actual source of truth — see the
// catch block below, which handles the race where two registrations for
// the same email land between this check and the INSERT.
//
// Note this is intentionally NOT enumeration-resistant: telling someone an
// email is already registered is normal signup UX (every major signup
// form does this) and is a different, much lower-stakes disclosure than
// the login-enumeration issue this project treats strictly elsewhere. See
// docs/THREAT-MODEL.md and README.md's API reference for the explicit
// scoping of that rule.
$existing = $db->prepare('SELECT id FROM users WHERE email = :email');
$existing->execute(['email' => $email]);
if ($existing->fetch() !== false) {
    pk_error_response('An account with that email already exists.', 409);
}

$storedAuthHash = pk_hash_auth_value($authHash, $pkConfig['pepper']);

try {
    $db->beginTransaction();

    $insertUser = $db->prepare(
        'INSERT INTO users (email, auth_hash, kdf_salt, kdf_params, wrapped_dek_password, wrapped_dek_recovery, recovery_key_created_at)
         VALUES (:email, :auth_hash, :kdf_salt, :kdf_params, :wrapped_dek_password, :wrapped_dek_recovery, :recovery_key_created_at)'
    );
    $insertUser->execute([
        'email'                   => $email,
        'auth_hash'               => $storedAuthHash,
        'kdf_salt'                => $kdfSalt,
        'kdf_params'              => $kdfParams,
        'wrapped_dek_password'    => $wrappedDekPassword,
        'wrapped_dek_recovery'    => $wrappedDekRecovery,
        'recovery_key_created_at' => $wrappedDekRecovery !== null ? date('Y-m-d H:i:s') : null,
    ]);
    $userId = (int) $db->lastInsertId();

    $insertVault = $db->prepare(
        'INSERT INTO vaults (user_id, ciphertext, revision) VALUES (:user_id, :ciphertext, 1)'
    );
    $insertVault->execute([
        'user_id'    => $userId,
        'ciphertext' => $vaultBlob,
    ]);

    $db->commit();
} catch (PDOException $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    if ($e->getCode() === '23000') {
        // Duplicate email, lost the race against a concurrent registration.
        pk_error_response('An account with that email already exists.', 409);
    }
    error_log('Pass Keeper register failed: ' . $e->getMessage());
    pk_error_response('Internal server error.', 500);
}

pk_login_session($userId, $email);
pk_issue_csrf_cookie($pkConfig);

pk_json_response(['user' => [
    'id' => $userId,
    'email' => $email,
    'recoveryKeyCreatedAt' => $wrappedDekRecovery !== null ? date('Y-m-d H:i:s') : null,
]], 201);
