import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, children, footer, className }) {
    const panelRef = useRef(null);
    const previouslyFocused = useRef(null);

    // Callers (e.g. Dashboard.jsx) routinely pass `onClose` as a new inline
    // arrow function on every render - that's normal and fine, but this
    // effect must NOT depend on it directly, or a parent re-render (even one
    // totally unrelated to this modal, like a 1-second countdown ticking
    // elsewhere on the page) would re-run the effect below and yank focus
    // back to the first field on every tick. Keeping the latest onClose in a
    // ref lets the effect depend on `open` alone while still always calling
    // the current onClose.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!open) return;

        previouslyFocused.current = document.activeElement;
        const panel = panelRef.current;
        const focusable = panel?.querySelectorAll(FOCUSABLE_SELECTOR);
        (focusable?.[0] ?? panel)?.focus();

        function handleKeyDown(e) {
            if (e.key === 'Escape') {
                onCloseRef.current();
                return;
            }
            if (e.key !== 'Tab' || !panel) return;

            const nodes = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR));
            if (nodes.length === 0) return;
            const first = nodes[0];
            const last = nodes[nodes.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused.current?.focus?.();
        };
        // Intentionally only `open` - see the onCloseRef comment above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!open) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-surface/80 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? 'modal-title' : undefined}
                tabIndex={-1}
                className={cn(
                    'relative w-full max-w-md rounded-lg border border-line bg-surface-overlay shadow-overlay',
                    'focus:outline-none',
                    className
                )}
            >
                {title && (
                    <div className="flex items-center justify-between border-b border-line px-5 py-4">
                        <h2 id="modal-title" className="text-sm font-semibold text-ink-primary">
                            {title}
                        </h2>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close dialog"
                            className="rounded-md p-1 text-ink-tertiary transition-colors duration-fast hover:bg-surface hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <X size={16} aria-hidden="true" />
                        </button>
                    </div>
                )}

                <div className="px-5 py-4">{children}</div>

                {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
            </div>
        </div>,
        document.body
    );
}
