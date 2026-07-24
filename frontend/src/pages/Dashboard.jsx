import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useVaultLock } from '../context/VaultLockContext.jsx';
import { decryptVault, encryptVault, VaultDecryptionError } from '../crypto/vaultCipher.js';
import { getVaultKey } from '../crypto/vaultKeyStore.js';
import TopBar from '../components/TopBar.jsx';
import SearchBar from '../components/SearchBar.jsx';
import VaultCard from '../components/VaultCard.jsx';
import EntryModal from '../components/EntryModal.jsx';
import Button from '../components/ui/Button.jsx';

export default function Dashboard() {
    const [entries, setEntries] = useState([]);
    const [revision, setRevision] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [modalEntry, setModalEntry] = useState(undefined); // undefined = closed, null = add, object = edit
    const { showToast } = useToast();
    const { lock, locked } = useVaultLock();

    const loadVault = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const { ciphertext, revision: serverRevision } = await api.getVault();
            const decrypted = await decryptVault(ciphertext, getVaultKey());
            setEntries(decrypted);
            setRevision(serverRevision);
        } catch (err) {
            if (err instanceof VaultDecryptionError) {
                // The key in memory can't open this ciphertext - most likely the
                // master password was changed on another device since this tab
                // derived its key. Re-locking prompts a fresh derivation instead
                // of showing a confusing decrypt error over an otherwise-usable page.
                showToast({ tone: 'danger', message: 'Could not unlock your vault with the current key. Please re-enter your password.' });
                lock();
                return;
            }
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [lock, showToast]);

    useEffect(() => {
        // Dashboard stays mounted (just `inert`) while the vault is locked - see
        // App.jsx's LockGate - so this must re-run every time `locked` goes from
        // true to false (initial unlock after a reload, or resuming after an
        // idle-timeout lock), not just once on mount.
        if (!locked) loadVault();
    }, [locked, loadVault]);

    const filteredEntries = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return entries;
        return entries.filter(
            (entry) => entry.platformName.toLowerCase().includes(q) || entry.username.toLowerCase().includes(q)
        );
    }, [entries, search]);

    /** Re-encrypts the full `nextEntries` array and saves it, handling the optimistic-concurrency conflict. */
    async function saveEntries(nextEntries) {
        const ciphertext = await encryptVault(nextEntries, getVaultKey());
        const revisionBeforeSave = revision;
        try {
            const { revision: newRevision } = await api.putVault({ ciphertext, revision, schemaVersion: 1 });
            setEntries(nextEntries);
            setRevision(newRevision);
        } catch (err) {
            if (err.status === 409) {
                showToast({ tone: 'danger', message: 'The vault changed elsewhere. Reloading the latest version.' });
                await loadVault();
                throw err;
            }
            if (err.isNetworkError) {
                // The write may have reached the server and committed before
                // the connection dropped - check rather than assume failure
                // (a false "it failed" here would invite the user to retry
                // and silently duplicate the entry they thought never saved).
                try {
                    const { revision: currentRevision } = await api.getVault();
                    if (currentRevision > revisionBeforeSave) {
                        showToast({ tone: 'success', message: 'Connection dropped, but the save went through.' });
                        await loadVault();
                        return; // the write landed; don't tell the caller it failed
                    }
                } catch {
                    // Can't even check right now - fall through to the honest "unknown" error below.
                }
                throw new Error('Lost connection while saving. Check your vault before retrying — it may or may not have gone through.');
            }
            throw err;
        }
    }

    async function handleSave(form) {
        const now = new Date().toISOString();
        let nextEntries;
        let label;

        if (modalEntry) {
            nextEntries = entries.map((e) => (e.id === modalEntry.id ? { ...e, ...form, updatedAt: now } : e));
            label = `${form.platformName} updated.`;
        } else {
            const newEntry = { ...form, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
            nextEntries = [...entries, newEntry];
            label = `${form.platformName} added.`;
        }

        await saveEntries(nextEntries);
        showToast({ tone: 'success', message: label });
        setModalEntry(undefined);
    }

    async function handleDelete(entry) {
        if (!window.confirm(`Delete the "${entry.platformName}" entry? This cannot be undone.`)) return;
        try {
            await saveEntries(entries.filter((e) => e.id !== entry.id));
            setModalEntry((current) => (current && current.id === entry.id ? undefined : current));
            showToast({ tone: 'success', message: `${entry.platformName} deleted.` });
        } catch (err) {
            showToast({ tone: 'danger', message: `Couldn't delete ${entry.platformName}: ${err.message}` });
            throw err;
        }
    }

    return (
        <div className="mx-auto max-w-3xl p-4 sm:p-6">
            <TopBar />

            <div className="mb-6 flex flex-col gap-3 sm:flex-row">
                <SearchBar value={search} onChange={setSearch} />
                <Button onClick={() => setModalEntry(null)} leftIcon={<Plus size={16} aria-hidden="true" />} className="whitespace-nowrap">
                    Add new
                </Button>
            </div>

            {loading && (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-secondary">
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    Decrypting your vault…
                </div>
            )}

            {!loading && error && (
                <div
                    role="alert"
                    className="flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-8 text-center"
                >
                    <AlertCircle size={20} className="text-danger" aria-hidden="true" />
                    <p className="text-sm text-danger">Couldn't load your vault: {error}</p>
                    <Button variant="secondary" size="sm" onClick={loadVault} leftIcon={<RefreshCw size={14} aria-hidden="true" />}>
                        Retry
                    </Button>
                </div>
            )}

            {!loading && !error && filteredEntries.length === 0 && (
                <p className="py-12 text-center text-sm text-ink-tertiary">
                    {entries.length === 0 ? 'Your vault is empty. Add your first entry to get started.' : 'No matching entries.'}
                </p>
            )}

            {!loading && !error && filteredEntries.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {filteredEntries.map((entry) => (
                        <VaultCard key={entry.id} entry={entry} onEdit={setModalEntry} onDelete={handleDelete} />
                    ))}
                </div>
            )}

            {modalEntry !== undefined && (
                <EntryModal
                    entry={modalEntry}
                    onClose={() => setModalEntry(undefined)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
}
