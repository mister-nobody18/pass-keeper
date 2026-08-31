import { ShieldCheck } from 'lucide-react';

// The icon badge + "Pass Keeper" wordmark shown atop every standalone
// auth-flow screen (login/signup, password reset, 2FA challenge, legal
// pages). `title`/`children` are optional so the compact variant (badge +
// wordmark only, used above the login/signup card) can reuse this too.
export default function AuthPageHeader({ title, children }) {
    return (
        <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
                <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
            </div>
            <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-tertiary">
                Pass Keeper
            </p>
            {title && <h1 className="text-xl font-semibold text-ink-primary">{title}</h1>}
            {children}
        </div>
    );
}
