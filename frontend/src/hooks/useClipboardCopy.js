import { useRef } from 'react';
import { useToast } from '../context/ToastContext.jsx';

const CLEAR_AFTER_MS = 20_000;

// Copies a secret to the clipboard and best-effort clears it again after CLEAR_AFTER_MS,
// regardless of whether the toast showing the countdown is dismissed early. This can't verify
// the clipboard still holds what we put there (reading it back would need an extra permission
// prompt) - if the user copies something else in the meantime, this will overwrite that too.
// That's the same trade-off every password manager with this feature makes.
export function useClipboardCopy() {
    const { showToast, dismissToast } = useToast();
    const clearTimerRef = useRef(null);
    const toastIdRef = useRef(null);

    async function copyWithAutoClear(text, label = 'Value') {
        await navigator.clipboard.writeText(text);

        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        if (toastIdRef.current) dismissToast(toastIdRef.current);

        toastIdRef.current = showToast({
            tone: 'neutral',
            message: `${label} copied to clipboard.`,
            durationMs: CLEAR_AFTER_MS,
        });

        clearTimerRef.current = setTimeout(async () => {
            try {
                await navigator.clipboard.writeText('');
            } catch {
                // Clipboard access can be revoked (tab lost focus/permission); nothing more we can do.
            }
        }, CLEAR_AFTER_MS);
    }

    return copyWithAutoClear;
}
