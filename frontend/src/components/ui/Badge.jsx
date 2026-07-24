import { cn } from '../../utils/cn.js';

const TONES = {
    accent: 'bg-accent/10 border-accent/30 text-accent',
    success: 'bg-success/10 border-success/30 text-success',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    danger: 'bg-danger/10 border-danger/30 text-danger',
    neutral: 'bg-surface border-line text-ink-secondary',
};

// Status is always conveyed by icon + text together, never colour alone.
export default function Badge({ tone = 'neutral', icon, children, className, ...rest }) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                TONES[tone],
                className
            )}
            {...rest}
        >
            {icon}
            {children}
        </span>
    );
}
