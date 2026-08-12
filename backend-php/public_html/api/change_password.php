<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('PUT');
$userId = pk_require_auth();
pk_verify_csrf();

$db = pk_db();
// Keyed on the authenticated user ID ALONE - not also IP. This endpoint
// already requires a valid session (pk_require_auth() above), so the ID
// isn't attacker-controlled; adding IP to the bucket key would let an
// attacker who already holds a stolen session cookie bypass the limit
// simply by rotating their apparent source IP (proxy pool, VPN, mobile
// network churn), making unlimited current-password guesses. See CHANGELOG.md.
pk_rate_limit_endpoint($db, $pkConfig, 'change_password', 'user:' . $userId);

$body = pk_read_json_body();

$currentAuthHash       = $body['currentAuthHash'] ?? null;
$newAuthHash           = $body['newAuthHash'] ?? null;
$newKdfSalt            = $body['newKdfSalt'] ?? null;
$newKdfParams          = $body['newKdfParams'] ?? null;
$newWrappedDekPassword = $body['newWrappedDekPassword'] ?? null;

if (!pk_valid_string($currentAuthHash, 16, 512) || !pk_valid_string($newAuthHash, 16, 512)) {
    pk_error_response('Current and new auth hashes are required.', 400);
}
if (!pk_valid_string($newKdfSalt, 8, 512) || !pk_valid_string($newKdfParams, 2, 512)) {
    pk_error_response('New KDF salt and parameters are required.', 400);
}
if (!pk_valid_string($newWrappedDekPassword, 1, 5000)) {
    pk_error_response('A valid wrapped key is required.', 400);
}

$stmt = $db->prepare('SELECT auth_hash FROM users WHERE id = :id');
$stmt->execute(['id' => $userId]);
$user = $stmt->fetch();

if ($user === false) {
    // The session says this user exists but the row is gone — should not
    // happen (users.id is what sessions are keyed on), but fail closed.
    error_log('Pass Keeper: change-password found no user row for session user_id=' . $userId);
    pk_error_response('Internal server error.', 500);
}

if (!pk_verify_auth_value($currentAuthHash, $pkConfig['pepper'], $user['auth_hash'])) {
    // The user is already authenticated for this session, so unlike login
    // there's no enumeration concern in saying specifically that the
    // *current* password was wrong.
    pk_error_response('Current password is incorrect.', 401);
}

// The vault's DEK never changes on a password change - only how it's
// wrapped. This means changing your master password no longer touches
// `vaults` at all: a single UPDATE on `users`, atomic by nature, no
// transaction or optimistic-concurrency dance needed. (Previously this
// endpoint re-encrypted the whole vault and required a cross-table
// transaction — see CHANGELOG.md for the migration that removed that.)
$updateUser = $db->prepare(
    'UPDATE users
     SET auth_hash = :auth_hash, kdf_salt = :kdf_salt, kdf_params = :kdf_params, wrapped_dek_password = :wrapped_dek_password
     WHERE id = :id'
);
$updateUser->execute([
    'auth_hash'            => pk_hash_auth_value($newAuthHash, $pkConfig['pepper']),
    'kdf_salt'             => $newKdfSalt,
    'kdf_params'           => $newKdfParams,
    'wrapped_dek_password' => $newWrappedDekPassword,
    'id'                   => $userId,
]);

// Rotate the session ID as an extra precaution after a credential change.
// This only affects THIS session/device — unlike the original Node
// prototype's in-memory session store, native PHP file-based sessions have
// no central index by user, so other active sessions on other devices
// can't be centrally revoked from here. See CONTRIBUTING.md.
session_regenerate_id(true);

pk_json_response(['user' => ['id' => $userId, 'email' => pk_current_email()]]);
