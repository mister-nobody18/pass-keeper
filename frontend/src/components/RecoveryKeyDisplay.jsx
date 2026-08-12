import { useState } from 'react';
import { AlertTriangle, Check, Copy, Download, KeyRound } from 'lucide-react';
import Panel from './ui/Panel.jsx';
import Button from './ui/Button.jsx';
import { useToast } from '../context/ToastContext.jsx';

/**
 * Shown exactly once, right after a recovery key is generated (registration,
 * a Settings-driven regenerate, or after a destructive reset). The caller is
 * responsible for discarding the raw key from its own state once
 * onContinue() fires - this component never persists it anywhere itself.
 *
 * @param {string} recoveryKey - formatted "XXXX-XXXX-..." key, shown once
 * @param {() => void} onContinue - called once the user has checked the
 *   acknowledgment box and clicked through
 * @param {string} [continueLabel]
 */
export default function RecoveryKeyDisplay({ recoveryKey, onContinue, continueLabel = 'Continue' }) {
    const { showToast } = useToast();
    const [copied, setCopied] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(recoveryKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            showToast({ tone: 'danger', message: `Couldn't copy recovery key: ${err.message}` });
        }
    }

    function handleDownload() {
        const body =
            `Pass Keeper recovery key\n` +
            `Generated: ${new Date().toISOString()}\n\n` +
            `${recoveryKey}\n\n` +
            'Keep this somewhere safe and offline (e.g. a printout, a password ' +
            "manager you already trust, a safe). Anyone who has this key can " +
            "decrypt your vault - treat it exactly like your master password. " +
            "Pass Keeper cannot show it to you again.\n";
        const blob = new Blob([body], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pass-keeper-recovery-key.txt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    return (
        <Panel padding="lg">
            <div className="mb-4 flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10">
                    <KeyRound className="h-4 w-4 text-accent" aria-hidden="true" />
                </div>
                <div>
                    <h3 className="font-medium text-ink-primary">Your recovery key</h3>
                    <p className="mt-1 text-sm text-ink-secondary">
                        This is the only way to get back into your vault if you forget your master
                        password. It's shown once, right now, and never again.
                    </p>
                </div>
            </div>

            <div className="rounded-md border border-line bg-surface px-4 py-3">
                <p className="select-all break-all font-mono text-sm tracking-wide text-ink-primary" aria-label="Recovery key">
                    {recoveryKey}
                </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={handleCopy} leftIcon={
                    copied ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />
                }>
                    {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={handleDownload} leftIcon={<Download size={14} aria-hidden="true" />}>
                    Download as .txt
                </Button>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                    Store it somewhere safe and offline. Anyone with this key can decrypt your vault -
                    treat it exactly like your master password.
                </span>
            </div>

            <label className="mt-4 flex items-start gap-2.5 text-sm text-ink-secondary">
                <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-line bg-surface text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <span>I've saved this recovery key somewhere safe. I understand Pass Keeper can't show it to me again.</span>
            </label>

            <Button type="button" variant="primary" className="mt-5 w-full" disabled={!acknowledged} onClick={onContinue}>
                {continueLabel}
            </Button>
        </Panel>
    );
}
