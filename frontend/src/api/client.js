const BASE = '/api';

// Paths where a 401 means "bad credentials" or "no such account," not "your
// session expired" - those must never trigger the global session-expiry
// event below, or a failed login/register would immediately wipe out any
// (unrelated) existing session. totp_verify.php belongs here for the same
// reason: it's called before a session exists at all (proving the password
// was correct but not yet the 2FA code), so a wrong-code 401 there isn't a
// session expiring either. Endpoints that need "wrong password/code"
// re-verification from an ALREADY-authenticated session (recovery_key.php,
// change_password.php, totp_disable.php, forget_devices.php,
// delete_account.php, totp_setup_confirm.php) use 403 for that failure
// instead of 401, specifically so they never need to be listed here - 401
// from any of them genuinely does mean the session ended.
const AUTH_ENTRY_PATHS = ['/register.php', '/login.php', '/totp_verify.php'];

function getCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

async function request(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (method !== 'GET') {
        const csrfToken = getCookie('pk_csrf');
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    }

    let res;
    try {
        res = await fetch(`${BASE}${path}`, {
            method,
            headers,
            credentials: 'include',
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (networkErr) {
        const err = new Error('Could not reach the server. Check your connection and try again.');
        err.isNetworkError = true;
        err.cause = networkErr;
        throw err;
    }

    let data = null;
    try {
        data = await res.json();
    } catch {
        // e.g. 204 No Content
    }

    if (!res.ok) {
        const err = new Error(data?.error || `Request failed (${res.status})`);
        err.status = res.status;
        err.data = data; // some endpoints (vault PUT/change-password conflicts) attach extra fields, e.g. currentRevision
        if (res.status === 401 && !AUTH_ENTRY_PATHS.includes(path)) {
            window.dispatchEvent(new CustomEvent('pk:session-expired'));
        }
        throw err;
    }
    return data;
}

export const api = {
    me: () => request('/me.php'),
    register: (payload) => request('/register.php', { method: 'POST', body: payload }),
    getLoginSalt: (email) => request(`/login_salt.php?email=${encodeURIComponent(email)}`),
    login: (payload) => request('/login.php', { method: 'POST', body: payload }),
    logout: () => request('/logout.php', { method: 'POST' }),

    getVault: () => request('/vault.php'),
    putVault: (payload) => request('/vault.php', { method: 'PUT', body: payload }),

    changePassword: (payload) => request('/change_password.php', { method: 'PUT', body: payload }),
    updateRecoveryKey: (payload) => request('/recovery_key.php', { method: 'PUT', body: payload }),
    migrateVault: (payload) => request('/migrate_vault.php', { method: 'PUT', body: payload }),

    // None of these three can return 401 under normal operation (none of
    // them require an existing session - see backend-php/public_html/api/
    // password_reset_*.php), so they don't need special handling in
    // AUTH_ENTRY_PATHS above the way login/register do.
    requestPasswordReset: (email) => request('/password_reset_request.php', { method: 'POST', body: { email } }),
    verifyPasswordResetToken: (token) => request(`/password_reset_verify.php?token=${encodeURIComponent(token)}`),
    confirmPasswordReset: (payload) => request('/password_reset_confirm.php', { method: 'POST', body: payload }),

    totpSetupBegin: () => request('/totp_setup_begin.php', { method: 'POST' }),
    totpSetupConfirm: (code) => request('/totp_setup_confirm.php', { method: 'POST', body: { code } }),
    totpDisable: (currentAuthHash) => request('/totp_disable.php', { method: 'PUT', body: { currentAuthHash } }),
    totpVerify: (payload) => request('/totp_verify.php', { method: 'POST', body: payload }),
    forgetDevices: (currentAuthHash) => request('/forget_devices.php', { method: 'PUT', body: { currentAuthHash } }),

    deleteAccount: (currentAuthHash) => request('/delete_account.php', { method: 'DELETE', body: { currentAuthHash } }),
};
