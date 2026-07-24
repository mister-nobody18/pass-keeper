import { forwardRef } from 'react';
import { cn } from '../../utils/cn.js';

const Textarea = forwardRef(function Textarea({ id, label, hint, className, ...rest }, ref) {
    return (
        <div className="space-y-1.5">
            {label && (
                <label htmlFor={id} className="block text-sm font-medium text-ink-secondary">
                    {label}
                </label>
            )}
            <textarea
                id={id}
                ref={ref}
                aria-describedby={hint ? `${id}-hint` : undefined}
                className={cn(
                    'w-full resize-none rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary transition-colors duration-fast',
                    'hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
                    className
                )}
                {...rest}
            />
            {hint && (
                <p id={`${id}-hint`} className="text-xs text-ink-tertiary">
                    {hint}
                </p>
            )}
        </div>
    );
});

export default Textarea;
