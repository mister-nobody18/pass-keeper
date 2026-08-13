import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { AlertCircle, KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '../api/client.js';
import Panel from './ui/Panel.jsx';
import Input from './ui/Input.jsx';
import Button from './ui/Button.jsx';

/**
 * Settings-driven 2FA enrollment: fetch a fresh secret, render it as a
 * scannable QR code (via the `qrcode` package - the frontend's second
 * deliberate dependency, alongside libsodium) plus selectable text for
 * manual entry, then require a real code from the authenticator app before
 * actually enabling anything server-side - see api/totp_setup_begin.php /
 * totp_setup_confirm.php. Mirrors RecoveryKeyDisplay.jsx's conventions:
 * this app's established pattern for "show a sensitive setup value once,
 * require explicit proof before continuing."
 *
 * @param {() => void} onCancel
 * @param {(enabledAt: string) => void} onEnabled
 */
export default function TwoFactorSetup({ onCancel, onEnabled }) {
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [secret, setSecret] = useState('');
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;

        api.totpSetupBegin()
            .then(async (data) => {
                if (cancelled) return;
                setSecret(data.secret);
                const dataUrl = await QRCode.toDataURL(data.otpauthUri, {
                    width: 220,
                    margin: 1,
                    color: { dark: '#0f1218', light: '#e7e9ee' },
                });
                if (!cancelled) setQrDataUrl(dataUrl);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    async function handleConfirm(e) {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            const { enabledAt } = await api.totpSetupConfirm(code);
            onEnabled(enabledAt);
        } catch (err) {
            setError(err.message);
            setCode('');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Panel padding="lg">
            <div className="mb-4 flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10">
                    <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
                </div>
                <div>
                    <h3 className="font-medium text-ink-primary">Set up two-factor authentication</h3>
                    <p className="mt-1 text-sm text-ink-secondary">
                        Scan this with Google Authenticator or any other TOTP app, then enter the 6-digit
                        code it shows to confirm.
                    </p>
                </div>
            </div>

            {loading && <p className="text-sm text-ink-tertiary">Generating your secret…</p>}

            {loadError && (
                <div
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                >
                    <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{loadError}</span>
                </div>
            )}

            {!loading && !loadError && (
                <>
                    <div className="flex justify-center rounded-md border border-line bg-surface p-4">
                        {qrDataUrl && <img src={qrDataUrl} alt="Scan this QR code with your authenticator app" width={220} height={220} />}
                    </div>

                    <p className="mt-3 text-center text-xs text-ink-tertiary">Can't scan? Enter this code manually:</p>
                    <div className="mt-1.5 rounded-md border border-line bg-surface px-4 py-2.5 text-center">
                        <span className="select-all break-all font-mono text-sm tracking-wide text-ink-primary">
                            {secret}
                        </span>
                    </div>

                    <form onSubmit={handleConfirm} className="mt-5 space-y-4" noValidate>
                        <Input
                            id="totp-setup-code"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            label="6-digit code"
                            required
                            maxLength={6}
                            disabled={submitting}
                            leftIcon={<KeyRound size={16} aria-hidden="true" />}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
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

                        <div className="flex gap-2">
                            <Button type="submit" size="sm" loading={submitting} disabled={code.length !== 6}>
                                {submitting ? 'Confirming…' : 'Confirm and enable'}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={onCancel}>
                                Cancel
                            </Button>
                        </div>
                    </form>
                </>
            )}
        </Panel>
    );
}
