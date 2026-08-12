import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Mail, MailCheck, ShieldCheck } from 'lucide-react';
import { api } from '../api/client.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Panel from '../components/ui/Panel.jsx';

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [sent, setSent] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            await api.requestPasswordReset(email);
            // Always shown regardless of whether the account exists - see
            // backend-php/public_html/api/password_reset_request.php. Revealing
            // that would let anyone probe which emails have an account here.
            setSent(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-sm">
                <div className="mb-8 flex flex-col items-center text-center">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
                        <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
                    </div>
                    <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-tertiary">
                        Pass Keeper
                    </p>
                    <h1 className="text-xl font-semibold text-ink-primary">Reset your password</h1>
                    <p className="mt-1.5 text-sm text-ink-secondary">
                        We'll email you a link to continue. Your vault data is only recoverable if you saved a
                        recovery key.
                    </p>
                </div>

                <Panel padding="lg">
                    {sent ? (
                        <div className="flex flex-col items-center gap-3 py-2 text-center">
                            <MailCheck className="h-8 w-8 text-accent" aria-hidden="true" />
                            <p className="text-sm text-ink-primary">
                                If an account exists for <span className="font-mono">{email}</span>, a password
                                reset link has been sent.
                            </p>
                            <p className="text-xs text-ink-tertiary">
                                The link expires in 10 minutes. Check your spam folder if it doesn't arrive soon.
                            </p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                            <Input
                                id="email"
                                type="email"
                                label="Email"
                                required
                                autoComplete="email"
                                autoFocus
                                disabled={submitting}
                                leftIcon={<Mail size={16} aria-hidden="true" />}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />

                            {error && (
                                <div
                                    role="alert"
                                    className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                                >
                                    <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <Button type="submit" variant="primary" className="w-full" loading={submitting}>
                                Send reset link
                            </Button>
                        </form>
                    )}
                </Panel>

                <p className="mt-6 text-center text-sm text-ink-secondary">
                    <Link
                        to="/login"
                        className="inline-flex items-center gap-1.5 rounded text-accent transition-colors duration-fast hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <ArrowLeft size={14} aria-hidden="true" />
                        Back to sign in
                    </Link>
                </p>
            </div>
        </div>
    );
}
