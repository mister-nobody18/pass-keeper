import crypto from 'node:crypto';

const TTL_MS = (Number(process.env.SESSION_TTL_MINUTES) || 60) * 60 * 1000;

// sessionId -> { userId, email, dek: Buffer, expiresAt: number }
// Intentionally in-memory only: the plaintext vault decryption key must never touch disk.
// This means all sessions are lost on server restart, forcing re-login - a deliberate tradeoff.
const sessions = new Map();

export function createSession(user, dek) {
    const sessionId = crypto.randomBytes(32).toString('base64url');
    sessions.set(sessionId, {
        userId: user.id,
        email: user.email,
        dek,
        expiresAt: Date.now() + TTL_MS,
    });
    return sessionId;
}

export function getSession(sessionId) {
    if (!sessionId) return null;
    const session = sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
        sessions.delete(sessionId);
        return null;
    }
    return session;
}

/** Sliding expiry: extend the session on activity. */
export function touchSession(sessionId) {
    const session = sessions.get(sessionId);
    if (session) session.expiresAt = Date.now() + TTL_MS;
}

export function destroySession(sessionId) {
    sessions.delete(sessionId);
}

/** Invalidate every session for a user, e.g. after a master password change. */
export function destroySessionsForUser(userId) {
    for (const [id, session] of sessions.entries()) {
        if (session.userId === userId) sessions.delete(id);
    }
}

setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
        if (session.expiresAt < now) sessions.delete(id);
    }
}, 5 * 60 * 1000).unref();

export const SESSION_TTL_MS = TTL_MS;
