import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockKeyhole, LogOut, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useVaultLock } from '../context/VaultLockContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import SessionStatus from './SessionStatus.jsx';
import AutoLockTimer from './AutoLockTimer.jsx';

export default function TopBar() {
    const { user, logout } = useAuth();
    const { locked, lock } = useVaultLock();
    const { showToast } = useToast();
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        function handleClickOutside(e) {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setMenuOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    async function handleLogout() {
        setMenuOpen(false);
        setLoggingOut(true);
        try {
            await logout();
            navigate('/login');
        } catch (err) {
            // Deliberately don't navigate away on failure - the server-side session may still
            // be live, and pretending we logged out would be a silent failure.
            showToast({ tone: 'danger', message: `Couldn't log out: ${err.message}` });
        } finally {
            setLoggingOut(false);
        }
    }

    const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : '?';

    return (
        <div className="mb-6 flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
                    <h1 className="text-lg font-semibold text-ink-primary">My vault</h1>
                </div>
                <SessionStatus status={locked ? 'locked' : 'unlocked'} />
                <AutoLockTimer />
            </div>

            <div className="relative shrink-0" ref={menuRef}>
                <button
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-on transition-colors duration-fast hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                    {initials}
                </button>

                {menuOpen && (
                    <div
                        role="menu"
                        className="absolute right-0 z-10 mt-2 w-52 overflow-hidden rounded-lg border border-line bg-surface-raised shadow-overlay"
                    >
                        <div className="border-b border-line px-4 py-3">
                            <p className="truncate text-sm text-ink-primary">{user?.email}</p>
                        </div>
                        <button
                            role="menuitem"
                            onClick={() => {
                                setMenuOpen(false);
                                lock();
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ink-primary transition-colors duration-fast hover:bg-surface"
                        >
                            <LockKeyhole size={15} aria-hidden="true" />
                            Lock vault now
                        </button>
                        <button
                            role="menuitem"
                            onClick={() => {
                                setMenuOpen(false);
                                navigate('/settings');
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ink-primary transition-colors duration-fast hover:bg-surface"
                        >
                            <SettingsIcon size={15} aria-hidden="true" />
                            Settings
                        </button>
                        <button
                            role="menuitem"
                            onClick={handleLogout}
                            disabled={loggingOut}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-danger transition-colors duration-fast hover:bg-surface disabled:opacity-60"
                        >
                            <LogOut size={15} aria-hidden="true" />
                            {loggingOut ? 'Logging out…' : 'Log out'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
