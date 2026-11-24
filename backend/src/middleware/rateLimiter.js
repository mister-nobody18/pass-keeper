import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

export const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many accounts created from this IP. Please try again later.' },
});

// Changing the master password re-verifies it, so it's effectively a second auth check and
// needs the same brute-force protection as login. Keyed on session + IP (rather than IP alone)
// so one attacker can't exhaust a shared/proxy IP's budget for other users' sessions.
export const settingsPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.sessionId || 'anon'}:${ipKeyGenerator(req.ip)}`,
    message: { error: 'Too many password change attempts. Please try again in 15 minutes.' },
});

// Loose, defense-in-depth ceiling for all /api/* traffic (not brute-force-focused endpoints,
// which have their own stricter limiters above).
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
});
