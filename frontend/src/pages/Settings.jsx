import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import TopBar from '../components/TopBar.jsx';

export default function Settings() {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    async function handleChangePassword(e) {
        e.preventDefault();
        setError('');
        setSuccess(false);

        if (newPassword.length < 10) {
            setError('New password must be at least 10 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('New passwords do not match.');
            return;
        }

        setSubmitting(true);
        try {
            await api.changePassword(currentPassword, newPassword);
            setSuccess(true);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="max-w-3xl mx-auto p-4 sm:p-6">
            <TopBar />

            <Link to="/" className="text-sm text-blue-400 hover:text-blue-300">
                ← Back to vault
            </Link>

            <h2 className="text-xl font-semibold mt-4 mb-6">Account settings</h2>

            <section className="bg-surface-raised border border-surface-border rounded-2xl p-6 mb-6">
                <h3 className="font-medium mb-1">Change master password</h3>
                <p className="text-sm text-slate-400 mb-4">
                    Your vault stays intact — entries are re-encrypted automatically under your new password.
                </p>

                <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Current password</label>
                        <input
                            type="password"
                            required
                            autoComplete="current-password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">New password</label>
                        <input
                            type="password"
                            required
                            minLength={10}
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Confirm new password</label>
                        <input
                            type="password"
                            required
                            autoComplete="new-password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                    </div>

                    {error && <p className="text-sm text-red-400">{error}</p>}
                    {success && <p className="text-sm text-green-400">Master password updated.</p>}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 transition-colors px-4 py-2 text-sm font-medium"
                    >
                        {submitting ? 'Updating…' : 'Update password'}
                    </button>
                </form>
            </section>

            <section className="bg-surface-raised border border-surface-border rounded-2xl p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-medium">Two-factor authentication</h3>
                        <p className="text-sm text-slate-400">Add an authenticator app for extra login security.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 uppercase tracking-wide">Coming soon</span>
                        <button
                            type="button"
                            disabled
                            title="Two-factor authentication is coming in a future update"
                            className="w-11 h-6 rounded-full bg-surface border border-surface-border cursor-not-allowed relative opacity-60"
                        >
                            <span className="absolute left-1 top-1 w-4 h-4 rounded-full bg-slate-500" />
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}
