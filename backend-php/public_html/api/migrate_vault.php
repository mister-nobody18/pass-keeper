<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('PUT');
$userId = pk_require_auth();
pk_verify_csrf();

$db = pk_db();
// Keyed on user id alone, same reasoning as change_password.php - this
// endpoint requires a valid session, so the id isn't attacker-controlled,
// and adding IP would only give an already-authenticated attacker a way to
// bypass the limit by rotating apparent source IP. In practice this fires
// at most once per account (the wrapped_dek_password IS NULL guard below
// makes every call after the first a no-op), so the limit is generous.
pk_rate_limit_endpoint($db, $pkConfig, 'migrate_vault', 'user:' . $userId);

$body = pk_read_json_body();

$newWrappedDekPassword = $body['newWrappedDekPassword'] ?? null;
$newVaultCiphertext    = $body['newVaultCiphertext'] ?? null;
$expectedRevision      = $body['expectedVaultRevision'] ?? null;

if (!pk_valid_string($newWrappedDekPassword, 1, 5000)) {
    pk_error_response('A valid wrapped key is required.', 400);
}
if (!pk_valid_string($newVaultCiphertext, 1, 5_000_000)) {
    pk_error_response('A valid vault ciphertext is required.', 400);
}
if (!pk_valid_uint($expectedRevision)) {
    pk_error_response('A valid revision is required.', 400);
}
$expectedRevision = (int) $expectedRevision;

// One-time, transparent upgrade path for accounts that predate the DEK/
// envelope model (see docs/ARCHITECTURE.md §6 and
// frontend/src/crypto/legacyMigration.js) - a real account with real data
// that existed before this feature shipped. Two guarded updates, one
// transaction:
//
//   1. Claim the migration - only succeeds if wrapped_dek_password is still
//      NULL. This is the same shape as pk_consume_reset_token()'s atomic
//      claim: it means two racing tabs/requests for the same account can't
//      both "win", and it's impossible for this endpoint to ever overwrite
//      an already-migrated account's real wrap.
//   2. Replace the vault's ciphertext with the DEK-re-encrypted version,
//      guarded by the same optimistic-concurrency revision check
//      vault.php's PUT uses.
//
// If either guard fails, nothing commits - the account stays exactly as it
// was, and the client falls back to using the vault directly with its
// password-derived key for that session (see legacyMigration.js), retrying
// this migration automatically on the next login.
try {
    $db->beginTransaction();

    $claimUser = $db->prepare(
        'UPDATE users SET wrapped_dek_password = :wrapped WHERE id = :id AND wrapped_dek_password IS NULL'
    );
    $claimUser->execute(['wrapped' => $newWrappedDekPassword, 'id' => $userId]);

    if ($claimUser->rowCount() === 0) {
        // Already migrated (e.g. another tab won the race) - not an error,
        // there's nothing left to do.
        $db->rollBack();
        pk_json_response(['migrated' => false]);
    }

    $updateVault = $db->prepare(
        'UPDATE vaults SET ciphertext = :ciphertext, revision = revision + 1
         WHERE user_id = :user_id AND revision = :expected_revision'
    );
    $updateVault->execute([
        'ciphertext'        => $newVaultCiphertext,
        'user_id'           => $userId,
        'expected_revision' => $expectedRevision,
    ]);

    if ($updateVault->rowCount() === 0) {
        $db->rollBack();
        pk_error_response('The vault changed elsewhere. Please retry.', 409);
    }

    $db->commit();
} catch (PDOException $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    error_log('Pass Keeper migrate_vault failed: ' . $e->getMessage());
    pk_error_response('Internal server error.', 500);
}

pk_json_response(['migrated' => true]);
