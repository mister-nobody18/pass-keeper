<?php

declare(strict_types=1);

/**
 * Fixed-window rate limiting backed by the `rate_limits` MySQL table —
 * no Redis or in-memory process available. The upsert is atomic under
 * InnoDB (INSERT ... ON DUPLICATE KEY UPDATE on the unique (bucket_key,
 * window_start) key), so concurrent requests can't race past the limit.
 * See docs/ARCHITECTURE.md §3 for the trade-offs versus a sliding window.
 */
function pk_rate_limit_hit(PDO $db, string $bucketKey, int $limit, int $windowSeconds): void
{
    // Lazy cleanup piggybacked on every call, so no cron job is required
    // for this table to stay small.
    $db->prepare('DELETE FROM rate_limits WHERE window_start < (NOW() - INTERVAL 1 DAY)')->execute();

    $windowStart = date('Y-m-d H:i:s', intdiv(time(), $windowSeconds) * $windowSeconds);

    $upsert = $db->prepare(
        'INSERT INTO rate_limits (bucket_key, window_start, attempt_count)
         VALUES (:bucket_key, :window_start, 1)
         ON DUPLICATE KEY UPDATE attempt_count = attempt_count + 1'
    );
    $upsert->execute([
        'bucket_key'   => $bucketKey,
        'window_start' => $windowStart,
    ]);

    $check = $db->prepare(
        'SELECT attempt_count FROM rate_limits WHERE bucket_key = :bucket_key AND window_start = :window_start'
    );
    $check->execute([
        'bucket_key'   => $bucketKey,
        'window_start' => $windowStart,
    ]);
    $count = (int) $check->fetchColumn();

    if ($count > $limit) {
        pk_error_response('Too many attempts. Please try again later.', 429);
    }
}

/**
 * Looks up the configured limit/window for $endpointName in config()['rate_limits']
 * and applies it to a bucket scoped by $identifier (an IP, a hashed email, a
 * "user:<id>:ip:<ip>" composite, etc. — the caller decides the dimension).
 */
function pk_rate_limit_endpoint(PDO $db, array $config, string $endpointName, string $identifier): void
{
    $rules = $config['rate_limits'][$endpointName] ?? null;
    if ($rules === null) {
        return;
    }
    $bucketKey = $endpointName . ':' . $identifier;
    pk_rate_limit_hit($db, $bucketKey, $rules['limit'], $rules['window_seconds']);
}
