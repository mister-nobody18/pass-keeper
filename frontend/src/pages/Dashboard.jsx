import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import TopBar from '../components/TopBar.jsx';
import SearchBar from '../components/SearchBar.jsx';
import VaultCard from '../components/VaultCard.jsx';
import EntryModal from '../components/EntryModal.jsx';

export default function Dashboard() {
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [modalEntry, setModalEntry] = useState(undefined); // undefined = closed, null = add, object = edit

    useEffect(() => {
        api.listEntries()
            .then((data) => setEntries(data.entries))
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    const filteredEntries = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return entries;
        return entries.filter(
            (entry) => entry.platformName.toLowerCase().includes(q) || entry.username.toLowerCase().includes(q)
        );
    }, [entries, search]);

    async function handleSave(form) {
        if (modalEntry) {
            const { entry } = await api.updateEntry(modalEntry.id, form);
            setEntries((prev) => prev.map((e) => (e.id === entry.id ? entry : e)));
        } else {
            const { entry } = await api.createEntry(form);
            setEntries((prev) => [...prev, entry]);
        }
        setModalEntry(undefined);
    }

    async function handleDelete(entry) {
        if (!window.confirm(`Delete the "${entry.platformName}" entry? This cannot be undone.`)) return;
        await api.deleteEntry(entry.id);
        setEntries((prev) => prev.filter((e) => e.id !== entry.id));
        setModalEntry(undefined);
    }

    return (
        <div className="max-w-3xl mx-auto p-4 sm:p-6">
            <TopBar />

            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <SearchBar value={search} onChange={setSearch} />
                <button
                    onClick={() => setModalEntry(null)}
                    className="rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors px-4 py-2 text-sm font-medium whitespace-nowrap"
                >
                    + Add new
                </button>
            </div>

            {loading && <p className="text-sm text-slate-400">Loading vault…</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}

            {!loading && !error && filteredEntries.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-12">
                    {entries.length === 0 ? 'Your vault is empty. Add your first entry to get started.' : 'No matching entries.'}
                </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filteredEntries.map((entry) => (
                    <VaultCard key={entry.id} entry={entry} onEdit={setModalEntry} onDelete={handleDelete} />
                ))}
            </div>

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
