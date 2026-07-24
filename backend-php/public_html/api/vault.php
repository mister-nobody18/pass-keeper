<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

$userId = pk_require_auth();
$db = pk_db();
$method = $_SERVER['REQUEST_METHOD'] ?? '';

if ($method === 'GET') {
    $stmt = $db->prepare(
        'SELECT ciphertext, schema_version, revision, updated_at FROM vaults WHERE user_id = :user_id'
    );
    $stmt->execute(['user_id' => $userId]);
    $vault = $stmt->fetch();

    if ($vault === false) {
        pk_error_response('Vault not found.', 404);
    }

    // (pk_json_response() already sets Cache-Control: no-store on every
    // response, which matters here since this one carries the encrypted
    // vault blob.)
    pk_json_response([
        'ciphertext'    => $vault['ciphertext'],
        'schemaVersion' => (int) $vault['schema_version'],
        'revision'      => (int) $vault['revision'],
        'updatedAt'     => $vault['updated_at'],
    ]);
}

if ($method === 'PUT') {
    pk_verify_csrf();

    $body = pk_read_json_body();
    $ciphertext       = $body['ciphertext'] ?? null;
    $expectedRevision = $body['revision'] ?? null;
    $schemaVersion    = $body['schemaVersion'] ?? 1;

    if (!pk_valid_string($ciphertext, 1, 5_000_000)) {
        pk_error_response('A valid vault ciphertext is required.', 400);
    }
    if (!pk_valid_uint($expectedRevision)) {
        pk_error_response('A valid revision is required.', 400);
    }
    if (!pk_valid_uint($schemaVersion)) {
        pk_error_response('A valid schema version is required.', 400);
    }
    $expectedRevision = (int) $expectedRevision;
    $schemaVersion = (int) $schemaVersion;

    // Optimistic concurrency: only commit if the row is still at the
    // revision the client last read. Two tabs/devices racing to save can't
    // silently clobber one another — the loser gets a 409 below instead.
    $update = $db->prepare(
        'UPDATE vaults
         SET ciphertext = :ciphertext, schema_version = :schema_version, revision = revision + 1
         WHERE user_id = :user_id AND revision = :expected_revision'
    );
    $update->execute([
        'ciphertext'        => $ciphertext,
        'schema_version'    => $schemaVersion,
        'user_id'           => $userId,
        'expected_revision' => $expectedRevision,
    ]);

    if ($update->rowCount() === 0) {
        $current = $db->prepare('SELECT revision FROM vaults WHERE user_id = :user_id');
        $current->execute(['user_id' => $userId]);
        $row = $current->fetch();

        if ($row === false) {
            pk_error_response('Vault not found.', 404);
        }

        pk_json_response([
            'error'           => 'The vault was changed elsewhere. Reload before saving again.',
            'currentRevision' => (int) $row['revision'],
        ], 409);
    }

    $updated = $db->prepare('SELECT revision, updated_at FROM vaults WHERE user_id = :user_id');
    $updated->execute(['user_id' => $userId]);
    $row = $updated->fetch();

    pk_json_response([
        'revision'  => (int) $row['revision'],
        'updatedAt' => $row['updated_at'],
    ]);
}

pk_error_response('Method not allowed.', 405);
