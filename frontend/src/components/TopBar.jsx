import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function TopBar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);
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
        await logout();
        navigate('/login');
    }

    const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : '?';

    return (
        <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
                <span className="text-blue-500 text-xl">🔒</span>
                <h1 className="text-lg font-semibold">My vault</h1>
            </div>

            <div className="relative" ref={menuRef}>
                <button
                    onClick={() => setMenuOpen((o) => !o)}
                    className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-xs font-semibold"
                >
                    {initials}
                </button>

                {menuOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-surface-raised border border-surface-border rounded-xl shadow-xl overflow-hidden z-10">
                        <div className="px-4 py-3 border-b border-surface-border">
                            <p className="text-sm truncate">{user?.email}</p>
                        </div>
                        <button
                            onClick={() => {
                                setMenuOpen(false);
                                navigate('/settings');
                            }}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-surface transition-colors"
                        >
                            Settings
                        </button>
                        <button
                            onClick={handleLogout}
                            className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-surface transition-colors"
                        >
                            Log out
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
