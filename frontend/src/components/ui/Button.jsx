import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const VARIANTS = {
    primary: 'bg-accent text-accent-on hover:bg-accent-hover active:bg-accent-hover',
    secondary:
        'bg-transparent text-ink-primary border border-line hover:border-line-strong hover:bg-surface-raised',
    ghost: 'bg-transparent text-ink-secondary hover:text-ink-primary hover:bg-surface-raised',
    danger: 'bg-transparent text-danger border border-danger/40 hover:bg-danger/10',
};

const SIZES = {
    md: 'px-4 py-2.5 text-sm',
    sm: 'px-3 py-1.5 text-xs',
};

const Button = forwardRef(function Button(
    { variant = 'primary', size = 'md', loading = false, disabled = false, leftIcon, className, children, ...rest },
    ref
) {
    return (
        <button
            ref={ref}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={cn(
                'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-base select-none',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                VARIANTS[variant],
                SIZES[size],
                className
            )}
            {...rest}
        >
            {loading ? (
                <Loader2 className="animate-spin" size={size === 'sm' ? 14 : 16} aria-hidden="true" />
            ) : (
                leftIcon
            )}
            {children}
        </button>
    );
});

export default Button;
