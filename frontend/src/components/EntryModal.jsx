import { useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, Trash2 } from 'lucide-react';
import Modal from './ui/Modal.jsx';
import Input from './ui/Input.jsx';
import Textarea from './ui/Textarea.jsx';
import Button from './ui/Button.jsx';
import PasswordStrengthMeter from './ui/PasswordStrengthMeter.jsx';
import AgeBadge from './ui/AgeBadge.jsx';
import { useHoldReveal } from '../hooks/useHoldReveal.js';
import { formatAbsoluteDate, formatRelativeTime } from '../utils/time.js';

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
    const { revealed, bind } = useHoldReveal();
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [deleting, setDeleting] = useState(false);

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

    async function handleDeleteClick() {
        setDeleting(true);
        try {
            await onDelete(entry);
        } catch {
            // Failure is already surfaced by the caller's toast; just stop showing the spinner.
        } finally {
            setDeleting(false);
        }
    }

    const busy = submitting || deleting;

    return (
        <Modal
            open
            onClose={onClose}
            title={isEditing ? 'Edit entry' : 'Add new entry'}
            footer={
                <div className="flex w-full items-center justify-between gap-3">
                    {isEditing ? (
                        <button
                            type="button"
                            onClick={handleDeleteClick}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-danger transition-colors duration-fast hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                        >
                            {deleting ? (
                                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                            ) : (
                                <Trash2 size={14} aria-hidden="true" />
                            )}
                            Delete
                        </button>
                    ) : (
                        <span />
                    )}
                    <div className="flex items-center gap-2">
                        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
                            Cancel
                        </Button>
                        <Button type="submit" form="entry-form" size="sm" loading={submitting} disabled={deleting}>
                            {submitting ? 'Saving…' : 'Save'}
                        </Button>
                    </div>
                </div>
            }
        >
            <form id="entry-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
                <Input
                    id="entry-platform"
                    label="Platform name"
                    required
                    value={form.platformName}
                    onChange={(e) => update('platformName', e.target.value)}
                />
                <Input
                    id="entry-username"
                    label="Username / email"
                    required
                    value={form.username}
                    onChange={(e) => update('username', e.target.value)}
                />
                <div>
                    <Input
                        id="entry-password"
                        type={revealed ? 'text' : 'password'}
                        label="Password"
                        required
                        value={form.password}
                        onChange={(e) => update('password', e.target.value)}
                        rightSlot={
                            <button
                                type="button"
                                onPointerDown={bind.onPointerDown}
                                onPointerUp={bind.onPointerUp}
                                onPointerLeave={bind.onPointerLeave}
                                aria-pressed={revealed}
                                aria-label={revealed ? 'Hide password' : 'Reveal password (click, or press and hold)'}
                                className="rounded p-1 text-ink-tertiary transition-colors duration-fast hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                {revealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                            </button>
                        }
                    />
                    <div className="mt-2">
                        <PasswordStrengthMeter password={form.password} context={[form.username]} />
                    </div>
                </div>
                <Input
                    id="entry-url"
                    label="URL (optional)"
                    value={form.url}
                    onChange={(e) => update('url', e.target.value)}
                    placeholder="https://"
                />
                <Textarea
                    id="entry-notes"
                    label="Notes (optional)"
                    rows={3}
                    value={form.notes}
                    onChange={(e) => update('notes', e.target.value)}
                />

                {isEditing && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-ink-tertiary">
                        <span title={formatAbsoluteDate(entry.createdAt)}>
                            Created {formatRelativeTime(entry.createdAt)}
                        </span>
                        <span title={formatAbsoluteDate(entry.updatedAt)}>
                            Updated {formatRelativeTime(entry.updatedAt)}
                        </span>
                        <AgeBadge updatedAt={entry.updatedAt} />
                    </div>
                )}

                {error && (
                    <div
                        role="alert"
                        className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                    >
                        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span>{error}</span>
                    </div>
                )}
            </form>
        </Modal>
    );
}
