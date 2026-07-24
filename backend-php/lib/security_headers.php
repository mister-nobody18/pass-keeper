<?php

declare(strict_types=1);

/**
 * These endpoints only ever return JSON, never HTML, so the CSP here can be
 * maximally strict. This is NOT the CSP for the frontend SPA's own HTML
 * page — that's a static file served alongside these endpoints with its
 * own, separately-configured CSP (script-src 'self', 'wasm-unsafe-eval' for
 * the Argon2id WASM module, etc. — see docs/ARCHITECTURE.md).
 */
function pk_send_security_headers(): void
{
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
    header_remove('X-Powered-By');
}
