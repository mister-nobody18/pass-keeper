import { useState } from 'react';
import { getInitials, getColorForName } from '../utils/platformIcon.js';

export default function VaultCard({ entry, onEdit, onDelete }) {
    const [revealed, setRevealed] = useState(false);
    const [copied, setCopied] = useState(false);

    async function handleCopy(e) {
        e.stopPropagation();
        await navigator.clipboard.writeText(entry.password);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    function handleReveal(e) {
        e.stopPropagation();
        setRevealed((r) => !r);
    }

    function handleDelete(e) {
        e.stopPropagation();
        onDelete(entry);
    }

    return (
        <div
            onClick={() => onEdit(entry)}
            className="group relative bg-surface-raised border border-surface-border rounded-2xl p-5 cursor-pointer hover:border-slate-600 transition-colors"
        >
            <button
                onClick={handleDelete}
                title="Delete entry"
                className="absolute top-4 right-4 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
                🗑
            </button>

            <div className="flex items-center gap-3 mb-4 pr-6">
                <div
                    className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-xs font-semibold text-white"
                    style={{ backgroundColor: getColorForName(entry.platformName) }}
                >
                    {getInitials(entry.platformName)}
                </div>
                <h3 className="font-medium truncate">{entry.platformName}</h3>
            </div>

            <p className="text-sm text-slate-400 truncate mb-3">{entry.username}</p>

            <div className="flex items-center justify-between bg-surface rounded-lg border border-surface-border px-3 py-2">
                <span className="text-sm tracking-widest text-slate-300 truncate">
                    {revealed ? entry.password : '•'.repeat(Math.min(entry.password.length, 12) || 10)}
                </span>
                <div className="flex items-center gap-2 shrink-0 pl-2">
                    <button onClick={handleReveal} title={revealed ? 'Hide password' : 'Reveal password'} className="text-slate-400 hover:text-slate-200">
                        {revealed ? '🙈' : '👁'}
                    </button>
                    <button onClick={handleCopy} title="Copy password" className="text-slate-400 hover:text-slate-200">
                        {copied ? '✓' : '📋'}
                    </button>
                </div>
            </div>
        </div>
    );
}
