import { getSession, touchSession } from '../services/session.service.js';

export const SESSION_COOKIE = 'sid';

export default function requireAuth(req, res, next) {
    const sessionId = req.signedCookies[SESSION_COOKIE];
    const session = getSession(sessionId);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated.' });
    }
    touchSession(sessionId);
    req.sessionId = sessionId;
    req.user = { id: session.userId, email: session.email };
    req.dek = session.dek;
    next();
}
