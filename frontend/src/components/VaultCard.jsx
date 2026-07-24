import { useState } from 'react';
import { Check, Copy, Eye, EyeOff, Loader2, Trash2 } from 'lucide-react';
import { getInitials, getColorForName } from '../utils/platformIcon.js';
import { formatRelativeTime } from '../utils/time.js';
import { useHoldReveal } from '../hooks/useHoldReveal.js';
import { useClipboardCopy } from '../hooks/useClipboardCopy.js';
import { useToast } from '../context/ToastContext.jsx';
import AgeBadge from './ui/AgeBadge.jsx';

export default function VaultCard({ entry, onEdit, onDelete }) {
    const { revealed, bind } = useHoldReveal();
    const [copied, setCopied] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const copyWithAutoClear = useClipboardCopy();
    const { showToast } = useToast();

    async function handleCopy(e) {
        e.stopPropagation();
        try {
            await copyWithAutoClear(entry.password, 'Password');
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            showToast({ tone: 'danger', message: `Couldn't copy password: ${err.message}` });
        }
    }

    async function handleDelete(e) {
        e.stopPropagation();
        setDeleting(true);
        try {
            await onDelete(entry);
        } catch {
            // Failure is already surfaced by the caller's toast; just stop showing the spinner.
        } finally {
            setDeleting(false);
        }
    }

    return (
        <div
            onClick={() => onEdit(entry)}
            className="group relative cursor-pointer rounded-lg border border-line bg-surface-raised p-5 transition-colors duration-fast hover:border-line-strong"
        >
            <button
                onClick={handleDelete}
                disabled={deleting}
                title="Delete entry"
                aria-label={`Delete ${entry.platformName}`}
                className="absolute right-4 top-4 rounded p-1 text-ink-tertiary opacity-0 transition-opacity duration-fast hover:text-danger focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100 disabled:opacity-100"
            >
                {deleting ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                ) : (
                    <Trash2 size={15} aria-hidden="true" />
                )}
            </button>

            <div className="mb-4 flex items-center gap-3 pr-6">
                <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white"
                    style={{ backgroundColor: getColorForName(entry.platformName) }}
                >
                    {getInitials(entry.platformName)}
                </div>
                <div className="min-w-0">
                    <h3 className="truncate font-medium text-ink-primary">{entry.platformName}</h3>
                    <p className="truncate text-sm text-ink-secondary">{entry.username}</p>
                </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2">
                <span className="truncate font-mono text-sm tracking-wide text-ink-primary">
                    {revealed ? entry.password : '•'.repeat(Math.min(entry.password.length, 12) || 10)}
                </span>
                <div className="flex shrink-0 items-center gap-1 pl-2">
                    <button
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => {
                            e.stopPropagation();
                            bind.onPointerDown(e);
                        }}
                        onPointerUp={(e) => {
                            e.stopPropagation();
                            bind.onPointerUp(e);
                        }}
                        onPointerLeave={bind.onPointerLeave}
                        title={revealed ? 'Hide password (click, or press and hold to reveal)' : 'Reveal password (click, or press and hold)'}
                        aria-pressed={revealed}
                        className="rounded p-1 text-ink-tertiary transition-colors duration-fast hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        {revealed ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                    </button>
                    <button
                        onClick={handleCopy}
                        title="Copy password"
                        aria-label="Copy password"
                        className="rounded p-1 text-ink-tertiary transition-colors duration-fast hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        {copied ? (
                            <Check size={15} className="text-success" aria-hidden="true" />
                        ) : (
                            <Copy size={15} aria-hidden="true" />
                        )}
                    </button>
                </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs text-ink-tertiary">Updated {formatRelativeTime(entry.updatedAt)}</p>
                <AgeBadge updatedAt={entry.updatedAt} />
            </div>
        </div>
    );
}
