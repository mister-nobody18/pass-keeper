import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import Panel from '../components/ui/Panel.jsx';

const LAST_UPDATED = '13 August 2026';

export default function PrivacyPolicy() {
    const { user } = useAuth();

    return (
        <div className="mx-auto max-w-2xl p-4 py-10 sm:p-6 sm:py-14">
            <div className="mb-8 flex flex-col items-center text-center">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
                    <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
                </div>
                <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-tertiary">Pass Keeper</p>
                <h1 className="text-xl font-semibold text-ink-primary">Privacy Policy</h1>
                <p className="mt-1.5 text-sm text-ink-tertiary">Last updated {LAST_UPDATED}</p>
            </div>

            <Panel padding="lg" className="space-y-6 text-sm leading-relaxed text-ink-secondary">
                <div className="rounded-md border border-line bg-surface px-4 py-3 text-xs text-ink-tertiary">
                    This describes, plainly and specifically, what Pass Keeper actually does with your
                    data — not generic legal boilerplate. See{' '}
                    <Link to="/cookies" className="text-accent hover:text-accent-hover">
                        Cookie Policy
                    </Link>{' '}
                    for what's set in your browser and why.
                </div>

                <section>
                    <h2 className="mb-1.5 font-medium text-ink-primary">Who's responsible for this data</h2>
                    <p>
                        Pass Keeper, operated by Cristian Soricu. For any privacy question or request, contact{' '}
                        <a href="mailto:cristi@soricu.com" className="text-accent hover:text-accent-hover">
                            cristi@soricu.com
                        </a>
                        .
                    </p>
                </section>

                <section>
                    <h2 className="mb-1.5 font-medium text-ink-primary">What we collect, and why</h2>
                    <ul className="list-disc space-y-1.5 pl-5">
                        <li>
                            <strong className="text-ink-primary">Your email address</strong> — identifies your
                            account and is where password-reset links are sent. Legal basis: necessary to
                            provide the service you signed up for.
                        </li>
                        <li>
                            <strong className="text-ink-primary">A password-derived value ("auth hash")</strong> —
                            proves you know your master password without the server ever seeing the
                            password itself. Necessary for login.
                        </li>
                        <li>
                            <strong className="text-ink-primary">Your vault, encrypted</strong> — every password
                            you save is encrypted in your browser before it's ever sent. The server stores
                            only the resulting ciphertext and cannot read it, under any circumstances,
                            including a lawful request — the decryption key never leaves your device.
                        </li>
                        <li>
                            <strong className="text-ink-primary">
                                An encrypted two-factor authentication secret
                            </strong>{' '}
                            — only if you turn 2FA on. Unlike everything else, this one has to be readable
                            by the server (it needs to verify a live 6-digit code), so it's encrypted at
                            rest rather than one-way hashed. See our{' '}
                            <a
                                href="https://github.com/mister-nobody18/pass-keeper/blob/main/docs/ARCHITECTURE.md"
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent hover:text-accent-hover"
                            >
                                architecture documentation
                            </a>{' '}
                            for exactly how.
                        </li>
                        <li>
                            <strong className="text-ink-primary">IP address</strong> — hashed before storage,
                            used only to rate-limit login/registration attempts and stop abuse. Visible
                            unhashed in transit and in ordinary web server logs, outside this app's control.
                        </li>
                    </ul>
                </section>

                <section>
                    <h2 className="mb-1.5 font-medium text-ink-primary">What we never collect</h2>
                    <p>
                        Your master password, the vault's actual encryption key in usable form, your
                        recovery key (shown to you once, never transmitted or stored anywhere by us), or
                        any plaintext vault content. This is by construction — see our published{' '}
                        <a
                            href="https://github.com/mister-nobody18/pass-keeper/blob/main/docs/THREAT-MODEL.md"
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:text-accent-hover"
                        >
                            threat model
                        </a>{' '}
                        for the honest limits of that guarantee.
                    </p>
                </section>

                <section>
                    <h2 className="mb-1.5 font-medium text-ink-primary">Sharing</h2>
                    <p>
                        We don't share your data with third parties, run analytics, or use advertising or
                        tracking of any kind. There is nothing to opt out of because nothing is collected
                        for those purposes in the first place.
                    </p>
                </section>

                <section>
                    <h2 className="mb-1.5 font-medium text-ink-primary">How long we keep it</h2>
                    <ul className="list-disc space-y-1.5 pl-5">
                        <li>Account and vault data: kept until you delete your account.</li>
                        <li>
                            Database backups: rotate on a 14-day cycle. If you delete your account, your
                            data can persist in a backup for up to 14 days afterward before it's fully gone.
                        </li>
                        <li>Password-reset links: expire after 10 minutes and can only be used once.</li>
                        <li>Rate-limiting records: short-lived, cleared automatically.</li>
                    </ul>
                </section>

                <section>
                    <h2 className="mb-1.5 font-medium text-ink-primary">Where it's hosted</h2>
                    <p>
                        On a server physically located in Romania. Data doesn't leave the EU/EEA as part of
                        providing this service.
                    </p>
                </section>

                <section>
                    <h2 className="mb-1.5 font-medium text-ink-primary">Your rights</h2>
                    <ul className="list-disc space-y-1.5 pl-5">
                        <li>
                            <strong className="text-ink-primary">Access and portability</strong> — use{' '}
                            <strong className="text-ink-primary">Export my data</strong> in Settings to download
                            your decrypted vault entries and account info as a file, generated entirely in
                            your browser.
                        </li>
                        <li>
                            <strong className="text-ink-primary">Erasure</strong> — use{' '}
                            <strong className="text-ink-primary">Delete my account</strong> in Settings to
                            permanently delete your account and vault immediately (subject to the backup
                            retention window above).
                        </li>
                        <li>
                            <strong className="text-ink-primary">Rectification</strong> — to correct your
                            registered email address, contact us directly; there's no self-service option for
                            this yet.
                        </li>
                        <li>
                            <strong className="text-ink-primary">Complaints</strong> — you can lodge a complaint
                            with Romania's National Supervisory Authority for Personal Data Processing
                            (ANSPDCP) if you believe your data has been mishandled.
                        </li>
                    </ul>
                </section>

                <section>
                    <h2 className="mb-1.5 font-medium text-ink-primary">A note on this policy</h2>
                    <p>
                        This is an honest, technically accurate description of what this specific
                        application does — the same standard of directness this project's published
                        architecture and threat-model documentation already holds itself to. It is not a
                        substitute for independent legal advice.
                    </p>
                </section>
            </Panel>

            <p className="mt-6 text-center text-sm text-ink-secondary">
                <Link
                    to={user ? '/settings' : '/login'}
                    className="inline-flex items-center gap-1.5 rounded text-accent transition-colors duration-fast hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <ArrowLeft size={14} aria-hidden="true" />
                    {user ? 'Back to settings' : 'Back to sign in'}
                </Link>
            </p>
        </div>
    );
}
