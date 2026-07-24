import { forwardRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const Input = forwardRef(function Input(
    { id, label, error, hint, required, leftIcon, rightSlot, className, ...rest },
    ref
) {
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

    return (
        <div className="space-y-1.5">
            {label && (
                <label htmlFor={id} className="block text-sm font-medium text-ink-secondary">
                    {label}
                    {required && (
                        <span className="ml-0.5 text-danger" aria-hidden="true">
                            *
                        </span>
                    )}
                </label>
            )}

            <div className="relative">
                {leftIcon && (
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary">
                        {leftIcon}
                    </span>
                )}
                <input
                    id={id}
                    ref={ref}
                    required={required}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    className={cn(
                        'w-full rounded-md border bg-surface py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary transition-colors duration-fast',
                        leftIcon ? 'pl-9' : 'pl-3',
                        rightSlot ? 'pr-10' : 'pr-3',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
                        error
                            ? 'border-danger focus-visible:ring-danger'
                            : 'border-line hover:border-line-strong focus-visible:ring-accent',
                        className
                    )}
                    {...rest}
                />
                {rightSlot && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">{rightSlot}</div>
                )}
            </div>

            {error && (
                <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs text-danger">
                    <AlertCircle size={13} className="shrink-0" aria-hidden="true" />
                    {error}
                </p>
            )}
            {!error && hint && (
                <p id={`${id}-hint`} className="text-xs text-ink-tertiary">
                    {hint}
                </p>
            )}
        </div>
    );
});

export default Input;
