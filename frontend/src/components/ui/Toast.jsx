import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const TONES = {
    success: { classes: 'border-success/30 bg-surface-overlay text-ink-primary', icon: CheckCircle2, iconClass: 'text-success' },
    danger: { classes: 'border-danger/30 bg-surface-overlay text-ink-primary', icon: AlertCircle, iconClass: 'text-danger' },
    neutral: { classes: 'border-line bg-surface-overlay text-ink-primary', icon: Info, iconClass: 'text-ink-tertiary' },
};

// A toast with `durationMs` shows a live countdown and calls `onExpire` (defaulting to
// dismissal) when it reaches zero. That countdown is purely visual bookkeeping - callers that
// need something to actually *happen* on expiry (e.g. clearing the clipboard) run their own
// timer independently, so the side effect still fires even if the user dismisses the toast early.
export default function Toast({ id, tone = 'neutral', message, durationMs, onDismiss }) {
    const [remainingMs, setRemainingMs] = useState(durationMs ?? null);
    const { icon: Icon, iconClass, classes } = TONES[tone] ?? TONES.neutral;

    useEffect(() => {
        if (!durationMs) return undefined;
        const startedAt = Date.now();
        const interval = setInterval(() => {
            const remaining = durationMs - (Date.now() - startedAt);
            if (remaining <= 0) {
                setRemainingMs(0);
                clearInterval(interval);
                onDismiss(id);
            } else {
                setRemainingMs(remaining);
            }
        }, 250);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [durationMs, id]);

    const progressPercent = durationMs ? Math.max(0, Math.min(100, (remainingMs / durationMs) * 100)) : null;

    return (
        <div
            role="status"
            className={cn(
                'relative w-full max-w-sm overflow-hidden rounded-md border shadow-overlay',
                classes
            )}
        >
            <div className="flex items-start gap-2.5 px-4 py-3">
                <Icon size={16} className={cn('mt-0.5 shrink-0', iconClass)} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm">{message}</p>
                    {durationMs !== undefined && durationMs !== null && (
                        <p className="mt-0.5 font-mono text-xs text-ink-tertiary">
                            Clears in {Math.ceil(remainingMs / 1000)}s
                        </p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => onDismiss(id)}
                    aria-label="Dismiss notification"
                    className="rounded p-0.5 text-ink-tertiary transition-colors duration-fast hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <X size={14} aria-hidden="true" />
                </button>
            </div>
            {progressPercent !== null && (
                <div className="h-0.5 w-full bg-surface">
                    {/* Width is computed per-tick from JS state; CSP's style-src already allows
                        this one inline-style path (see app.js), same as VaultCard's avatar color. */}
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${progressPercent}%` }} />
                </div>
            )}
        </div>
    );
}
