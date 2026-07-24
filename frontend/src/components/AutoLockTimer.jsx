import { useEffect, useState } from 'react';
import { RefreshCw, Timer } from 'lucide-react';
import { useVaultLock } from '../context/VaultLockContext.jsx';
import { formatCountdown } from '../utils/time.js';
import { cn } from '../utils/cn.js';

const TICK_MS = 1000;

export default function AutoLockTimer({ className }) {
    const { getRemainingMs, idleLockMs, extend, locked } = useVaultLock();
    // This is the ONE piece of state in the app that updates every second -
    // deliberately kept local to this small leaf component (see
    // VaultLockContext.jsx) so that 1Hz re-render never propagates up into
    // Dashboard, EntryModal, or anything else on the page.
    const [remainingMs, setRemainingMs] = useState(getRemainingMs);

    useEffect(() => {
        if (locked) return undefined;
        setRemainingMs(getRemainingMs());
        const interval = setInterval(() => setRemainingMs(getRemainingMs()), TICK_MS);
        return () => clearInterval(interval);
    }, [locked, getRemainingMs]);

    if (locked) return null;

    const low = remainingMs <= 60_000;

    return (
        <div
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-mono',
                low ? 'border-warning/30 bg-warning/10 text-warning' : 'border-line bg-surface text-ink-tertiary',
                className
            )}
            title={`Vault auto-locks after ${Math.round(idleLockMs / 60000)} minutes of inactivity`}
        >
            <Timer size={12} aria-hidden="true" />
            <span aria-live="off">Auto-lock {formatCountdown(remainingMs)}</span>
            <button
                type="button"
                onClick={extend}
                aria-label="Extend session"
                className="ml-0.5 rounded p-0.5 text-inherit transition-colors duration-fast hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <RefreshCw size={12} aria-hidden="true" />
            </button>
        </div>
    );
}
