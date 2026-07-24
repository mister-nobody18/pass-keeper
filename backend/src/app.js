import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import authRoutes from './routes/auth.routes.js';
import vaultRoutes from './routes/vault.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import { apiLimiter } from './middleware/rateLimiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.COOKIE_SECRET) {
    throw new Error('COOKIE_SECRET must be set (see .env.example).');
}

const app = express();

app.disable('x-powered-by');
// Explicit CSP tuned to this app's actual asset sources: the built SPA is same-origin,
// module-script only, no CDNs/fonts/images from elsewhere. style-src allows 'unsafe-inline'
// only for the one dynamic inline `style` attribute used in VaultCard.jsx (Tailwind handles
// everything else via static classes, so no <style>/script inline content is needed).
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:'],
                fontSrc: ["'self'"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                frameAncestors: ["'none'"],
            },
        },
    })
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// Loose ceiling on all API traffic; auth-critical endpoints layer stricter limiters on top.
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/settings', settingsRoutes);

// Serve the built frontend as a static SPA in production (npm run build populates this dir).
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get(/^(?!\/api).*/, (req, res) => {
        res.sendFile(path.join(frontendDist, 'index.html'));
    });
}

app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error.' });
});

export default app;
