import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { VaultLockProvider, useVaultLock } from './context/VaultLockContext.jsx';
import LockScreen from './components/LockScreen.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Settings from './pages/Settings.jsx';

function LockGate({ children }) {
    const { locked } = useVaultLock();
    return (
        <>
            {/* `inert` keeps the vault unreachable by keyboard/assistive tech while locked,
                not just visually obscured. */}
            <div inert={locked ? '' : undefined}>{children}</div>
            {locked && <LockScreen />}
        </>
    );
}

function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();
    if (loading) return null;
    if (!user) return <Navigate to="/login" replace />;
    return (
        <VaultLockProvider>
            <LockGate>{children}</LockGate>
        </VaultLockProvider>
    );
}

function PublicOnlyRoute({ children }) {
    const { user, loading } = useAuth();
    if (loading) return null;
    if (user) return <Navigate to="/" replace />;
    return children;
}

export default function App() {
    return (
        <Routes>
            <Route
                path="/login"
                element={
                    <PublicOnlyRoute>
                        <Login />
                    </PublicOnlyRoute>
                }
            />
            <Route
                path="/register"
                element={
                    <PublicOnlyRoute>
                        <Register />
                    </PublicOnlyRoute>
                }
            />
            <Route
                path="/"
                element={
                    <ProtectedRoute>
                        <Dashboard />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/settings"
                element={
                    <ProtectedRoute>
                        <Settings />
                    </ProtectedRoute>
                }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
