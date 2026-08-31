import { AlertCircle } from 'lucide-react';
import { cn } from '../../utils/cn.js';

export default function ErrorAlert({ children, className }) {
    return (
        <div
            role="alert"
            className={cn(
                'flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger',
                className
            )}
        >
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{children}</span>
        </div>
    );
}
