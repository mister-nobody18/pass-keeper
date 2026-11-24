import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { VaultLockProvider, useVaultLock } from './context/VaultLockContext.jsx';
import LockScreen from './components/LockScreen.jsx';
import Auth from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Settings from './pages/Settings.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';
import CookiePolicy from './pages/CookiePolicy.jsx';

function LockGate({ children }) {
    const { locked } = useVaultLock();
    return (
        <>
            {/* `inert` keeps the vault unreachable by keyboard/assistive tech while locked,
                not just visually obscured. */}
            <div inert={locked}>{children}</div>
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
                        <Auth />
                    </PublicOnlyRoute>
                }
            />
            <Route
                path="/register"
                element={
                    <PublicOnlyRoute>
                        <Auth />
                    </PublicOnlyRoute>
                }
            />
            <Route
                path="/forgot-password"
                element={
                    <PublicOnlyRoute>
                        <ForgotPassword />
                    </PublicOnlyRoute>
                }
            />
            <Route
                path="/reset-password"
                element={
                    <PublicOnlyRoute>
                        <ResetPassword />
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
            {/* Unguarded on purpose - reachable whether signed in (from Settings)
                or not (from the Auth screen's footer), never gated by
                PublicOnlyRoute/ProtectedRoute. */}
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/cookies" element={<CookiePolicy />} />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
