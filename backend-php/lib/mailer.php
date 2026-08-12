<?php

declare(strict_types=1);

/**
 * Sends the password-reset email via PHP's native mail() — zero
 * dependencies, matching the rest of this backend. See docs/DEPLOYMENT.md
 * for configuring SPF/DKIM on the sending domain so it doesn't land in spam.
 */
function pk_send_password_reset_email(array $config, string $toEmail, string $resetUrl, int $expiryMinutes): bool
{
    // $toEmail must already have passed pk_valid_email() before this is
    // called (every call site validates it upstream) — filter_var'd email
    // addresses cannot contain the CR/LF needed for header injection, but
    // this call is cheap insurance against ever being handed something
    // unvalidated in the future.
    if (!pk_valid_email($toEmail)) {
        error_log('Pass Keeper: pk_send_password_reset_email() called with an invalid address, refusing to send.');
        return false;
    }

    $fromAddress = $config['mail']['from_address'] ?? 'noreply@localhost';
    $fromName = $config['mail']['from_name'] ?? 'Pass Keeper';

    $subject = 'Reset your Pass Keeper master password';

    $body = <<<TEXT
A password reset was requested for this email address.

To choose a new master password, open this link within the next {$expiryMinutes} minutes:

{$resetUrl}

If you have your recovery key, you'll be able to keep your existing vault.
If you don't, resetting will start a new, empty vault and your old entries
cannot be recovered without the recovery key.

If you didn't request this, you can safely ignore this email and no change
will be made to your account unless the link above is used.
TEXT;

    // Headers built entirely from server-side config values and a
    // pre-validated address - no request-supplied string is interpolated
    // into any header here, which is what actually prevents header
    // injection (email-address validation alone is necessary but not
    // sufficient if some OTHER field were ever added to these headers).
    $headers = [];
    $headers[] = 'From: ' . $fromName . ' <' . $fromAddress . '>';
    $headers[] = 'Content-Type: text/plain; charset=utf-8';
    $headers[] = 'X-Auto-Response-Suppress: All';

    return mail($toEmail, $subject, $body, implode("\r\n", $headers));
}
