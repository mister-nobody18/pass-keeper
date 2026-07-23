import crypto from 'node:crypto';

// Hand-rolled double-submit-cookie CSRF protection. Kept dependency-free and simple to audit:
// a JS-readable cookie must match a custom header, which a cross-site attacker cannot set
// because they cannot read the victim's cookie value (same-origin policy).
export const CSRF_COOKIE = 'csrfToken';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfCookie(res) {
    const token = crypto.randomBytes(32).toString('base64url');
    res.cookie(CSRF_COOKIE, token, {
        httpOnly: false, // must be readable by frontend JS to echo back in the header
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
    });
    return token;
}

export function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const cookieToken = req.cookies[CSRF_COOKIE];
    const headerToken = req.get(CSRF_HEADER);
    if (!cookieToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
        return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
    }
    next();
}

function tokensMatch(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
