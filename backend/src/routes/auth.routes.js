import { Router } from 'express';
import { registerUser, verifyLogin, AuthError, findUserById, toPublicUser } from '../services/user.service.js';
import { createSession, destroySession } from '../services/session.service.js';
import { loginLimiter, registerLimiter } from '../middleware/rateLimiter.js';
import requireAuth, { SESSION_COOKIE } from '../middleware/requireAuth.js';
import { issueCsrfCookie, CSRF_COOKIE } from '../middleware/csrf.js';
import { sessionCookieOptions } from '../utils/cookies.js';

const router = Router();

function establishSession(res, user, dek) {
    const sessionId = createSession(user, dek);
    res.cookie(SESSION_COOKIE, sessionId, sessionCookieOptions());
    issueCsrfCookie(res);
}

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/register', registerLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'A valid email is required.' });
    }
    if (typeof password !== 'string' || password.length < 10) {
        return res.status(400).json({ error: 'Master password must be at least 10 characters.' });
    }

    try {
        const { user, dek } = await registerUser(email, password);
        establishSession(res, user, dek);
        res.status(201).json({ user: toPublicUser(user) });
    } catch (err) {
        if (err instanceof AuthError) {
            return res.status(409).json({ error: err.message });
        }
        throw err;
    }
});

router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || typeof password !== 'string') {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        const { user, dek } = await verifyLogin(email, password);
        establishSession(res, user, dek);
        res.json({ user: toPublicUser(user) });
    } catch (err) {
        if (err instanceof AuthError) {
            return res.status(401).json({ error: err.message });
        }
        throw err;
    }
});

router.post('/logout', requireAuth, (req, res) => {
    destroySession(req.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
    res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
    const user = findUserById(req.user.id);
    res.json({ user: toPublicUser(user) });
});

export default router;
