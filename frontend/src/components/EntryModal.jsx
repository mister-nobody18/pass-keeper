import { useState } from 'react';

const emptyForm = { platformName: '', username: '', password: '', url: '', notes: '' };

export default function EntryModal({ entry, onClose, onSave, onDelete }) {
    const isEditing = !!entry;
    const [form, setForm] = useState(
        entry
            ? {
                  platformName: entry.platformName,
                  username: entry.username,
                  password: entry.password,
                  url: entry.url || '',
                  notes: entry.notes || '',
              }
            : emptyForm
    );
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    function update(field, value) {
        setForm((f) => ({ ...f, [field]: value }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        if (!form.platformName.trim() || !form.username.trim() || !form.password) {
            setError('Platform, username, and password are required.');
            return;
        }
        setSubmitting(true);
        try {
            await onSave(form);
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-20" onClick={onClose}>
            <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md bg-surface-raised border border-surface-border rounded-2xl p-6 shadow-xl max-h-[90vh] overflow-y-auto"
            >
                <h2 className="text-lg font-semibold mb-4">{isEditing ? 'Edit entry' : 'Add new entry'}</h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Platform name</label>
                        <input
                            type="text"
                            required
                            value={form.platformName}
                            onChange={(e) => update('platformName', e.target.value)}
                            className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Username / email</label>
                        <input
                            type="text"
                            required
                            value={form.username}
                            onChange={(e) => update('username', e.target.value)}
                            className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Password</label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                required
                                value={form.password}
                                onChange={(e) => update('password', e.target.value)}
                                className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword((s) => !s)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                            >
                                {showPassword ? '🙈' : '👁'}
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">URL (optional)</label>
                        <input
                            type="text"
                            value={form.url}
                            onChange={(e) => update('url', e.target.value)}
                            placeholder="https://"
                            className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Notes (optional)</label>
                        <textarea
                            value={form.notes}
                            onChange={(e) => update('notes', e.target.value)}
                            rows={3}
                            className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
                        />
                    </div>

                    {error && <p className="text-sm text-red-400">{error}</p>}

                    <div className="flex items-center gap-3 pt-2">
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 transition-colors py-2 text-sm font-medium"
                        >
                            {submitting ? 'Saving…' : 'Save'}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 rounded-lg border border-surface-border hover:bg-surface transition-colors py-2 text-sm font-medium"
                        >
                            Cancel
                        </button>
                    </div>

                    {isEditing && (
                        <button
                            type="button"
                            onClick={() => onDelete(entry)}
                            className="w-full text-sm text-red-400 hover:text-red-300 pt-2"
                        >
                            Delete entry
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
}
