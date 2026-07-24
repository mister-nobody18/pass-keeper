import { SESSION_TTL_MS } from '../services/session.service.js';

export function sessionCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        signed: true,
        path: '/',
        maxAge: SESSION_TTL_MS,
    };
}
