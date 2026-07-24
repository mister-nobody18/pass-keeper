import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { listEntries, getEntry, createEntry, updateEntry, deleteEntry } from '../services/vault.service.js';

const router = Router();

router.use(requireAuth);
router.use(csrfProtection);
// Every response from this router carries decrypted vault secrets - never let it be cached.
router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

function validateEntryBody(body) {
    const { platformName, username, password } = body || {};
    if (typeof platformName !== 'string' || !platformName.trim()) return 'Platform name is required.';
    if (typeof username !== 'string' || !username.trim()) return 'Username is required.';
    if (typeof password !== 'string' || !password) return 'Password is required.';
    return null;
}

router.get('/', (req, res) => {
    res.json({ entries: listEntries(req.user.id, req.dek) });
});

router.get('/:id', (req, res) => {
    const entry = getEntry(req.user.id, Number(req.params.id), req.dek);
    if (!entry) return res.status(404).json({ error: 'Entry not found.' });
    res.json({ entry });
});

router.post('/', (req, res) => {
    const validationError = validateEntryBody(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const { platformName, username, password, url, notes } = req.body;
    const entry = createEntry(req.user.id, req.dek, { platformName, username, password, url, notes });
    res.status(201).json({ entry });
});

router.put('/:id', (req, res) => {
    const validationError = validateEntryBody(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const { platformName, username, password, url, notes } = req.body;
    const entry = updateEntry(req.user.id, Number(req.params.id), req.dek, {
        platformName,
        username,
        password,
        url,
        notes,
    });
    if (!entry) return res.status(404).json({ error: 'Entry not found.' });
    res.json({ entry });
});

router.delete('/:id', (req, res) => {
    const deleted = deleteEntry(req.user.id, Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Entry not found.' });
    res.status(204).end();
});

export default router;
