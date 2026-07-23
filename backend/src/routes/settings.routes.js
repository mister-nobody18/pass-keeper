import { Router } from 'express';
import requireAuth, { SESSION_COOKIE } from '../middleware/requireAuth.js';
import { csrfProtection, issueCsrfCookie } from '../middleware/csrf.js';
import { changePassword, AuthError, findUserById, toPublicUser } from '../services/user.service.js';
import { createSession, destroySessionsForUser, SESSION_TTL_MS } from '../services/session.service.js';

const router = Router();

router.use(requireAuth);
router.use(csrfProtection);

// Note: 2FA is intentionally NOT wired up here yet. The `two_fa_enabled` / `two_fa_secret`
// columns exist on the users table for a future phase; the settings UI only shows a
// disabled "coming soon" toggle for now, so there is no endpoint to back it yet.

router.put('/password', async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 10) {
        return res.status(400).json({ error: 'Current password and a new password (min 10 characters) are required.' });
    }

    try {
        const dek = await changePassword(req.user.id, currentPassword, newPassword);

        // Changing the master password invalidates every existing session (including this
        // one) as a precaution, then immediately issues a fresh session for this request.
        destroySessionsForUser(req.user.id);
        const user = findUserById(req.user.id);
        const sessionId = createSession(user, dek);
        res.cookie(SESSION_COOKIE, sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            signed: true,
            path: '/',
            maxAge: SESSION_TTL_MS,
        });
        issueCsrfCookie(res);

        res.json({ user: toPublicUser(user) });
    } catch (err) {
        if (err instanceof AuthError) {
            return res.status(401).json({ error: err.message });
        }
        throw err;
    }
});

export default router;
