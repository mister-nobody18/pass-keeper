import { createContext, useCallback, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import Toast from '../components/ui/Toast.jsx';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const dismissToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const showToast = useCallback((toast) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setToasts((prev) => [...prev, { id, tone: 'neutral', ...toast }]);
        if (!toast.durationMs) {
            // Toasts without an explicit countdown still shouldn't pile up forever.
            setTimeout(() => dismissToast(id), 6000);
        }
        return id;
    }, [dismissToast]);

    return (
        <ToastContext.Provider value={{ showToast, dismissToast }}>
            {children}
            {createPortal(
                <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
                    {toasts.map((toast) => (
                        <Toast key={toast.id} {...toast} onDismiss={dismissToast} />
                    ))}
                </div>,
                document.body
            )}
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within a ToastProvider');
    return ctx;
}
