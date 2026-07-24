<?php

declare(strict_types=1);

function pk_valid_email(string $email): bool
{
    return $email !== ''
        && strlen($email) <= 255
        && filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

/**
 * @param mixed $value
 */
function pk_valid_string($value, int $minLen = 1, int $maxLen = 1000): bool
{
    return is_string($value) && strlen($value) >= $minLen && strlen($value) <= $maxLen;
}

/**
 * True for a non-negative integer, expressed either as a real int or as a
 * digit-only string (JSON doesn't distinguish, and callers here always want
 * this for values that map to UNSIGNED MySQL columns — revision numbers,
 * schema versions). ctype_digit() already excludes '-', so this rejects
 * negative numbers by construction; there is no unsigned-but-negative case
 * to special-case.
 *
 * @param mixed $value
 */
function pk_valid_uint($value): bool
{
    return (is_int($value) && $value >= 0) || (is_string($value) && $value !== '' && ctype_digit($value));
}
