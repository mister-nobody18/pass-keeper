import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import AuthPageHeader from '../components/ui/AuthPageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';

const LAST_UPDATED = '13 August 2026';

const COOKIES = [
    {
        name: 'pk_session',
        duration: 'Until you log out or the session times out',
        necessary: true,
        purpose: 'Keeps you signed in. Without it, every page load would require re-entering your password.',
    },
    {
        name: 'pk_csrf',
        duration: 'Same as pk_session',
        necessary: true,
        purpose:
            "A security token that proves a request actually came from this app's own pages, not a malicious site tricking your browser into acting on your behalf.",
    },
    {
        name: 'pk_trusted_device',
        duration: '30 days',
        necessary: false,
        purpose:
            'Set only if you check "remember this device" when entering a two-factor authentication code. Lets that device skip the code for 30 days. Never set unless you take that specific action.',
    },
];

export default function CookiePolicy() {
    const { user } = useAuth();

    return (
        <div className="mx-auto max-w-2xl p-4 py-10 sm:p-6 sm:py-14">
            <AuthPageHeader title="Cookie Policy">
                <p className="mt-1.5 text-sm text-ink-tertiary">Last updated {LAST_UPDATED}</p>
            </AuthPageHeader>

            <Panel padding="lg" className="space-y-6 text-sm leading-relaxed text-ink-secondary">
                <p>
                    Pass Keeper sets exactly three cookies, all first-party, all serving the app itself —
                    no advertising, no analytics, no third-party trackers of any kind.
                </p>

                <div className="overflow-x-auto rounded-md border border-line">
                    <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                        <thead>
                            <tr className="border-b border-line bg-surface">
                                <th className="px-3 py-2 font-medium text-ink-primary">Cookie</th>
                                <th className="px-3 py-2 font-medium text-ink-primary">Duration</th>
                                <th className="px-3 py-2 font-medium text-ink-primary">Necessary?</th>
                            </tr>
                        </thead>
                        <tbody>
                            {COOKIES.map((cookie) => (
                                <tr key={cookie.name} className="border-b border-line last:border-0">
                                    <td className="px-3 py-2 font-mono text-xs text-ink-primary">{cookie.name}</td>
                                    <td className="px-3 py-2 text-ink-secondary">{cookie.duration}</td>
                                    <td className="px-3 py-2 text-ink-secondary">
                                        {cookie.necessary ? 'Strictly necessary' : 'Only if you opt in'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="space-y-4">
                    {COOKIES.map((cookie) => (
                        <div key={cookie.name}>
                            <h2 className="font-mono text-sm text-ink-primary">{cookie.name}</h2>
                            <p className="mt-1">{cookie.purpose}</p>
                        </div>
                    ))}
                </div>

                <section>
                    <h2 className="mb-1.5 font-medium text-ink-primary">On consent</h2>
                    <p>
                        <span className="font-mono text-xs text-ink-primary">pk_session</span> and{' '}
                        <span className="font-mono text-xs text-ink-primary">pk_csrf</span> are strictly
                        necessary for the app to function at all — signing in, keeping you signed in, and
                        protecting against cross-site request forgery — so they're set without asking, the
                        same way any login-based site's session cookie works.{' '}
                        <span className="font-mono text-xs text-ink-primary">pk_trusted_device</span> is
                        different: it's set only as the direct result of you explicitly checking "remember
                        this device" on the two-factor authentication screen. That checkbox is the consent —
                        we don't set it silently, and unchecking it (or never checking it) means it's never
                        set at all.
                    </p>
                </section>

                <section>
                    <h2 className="mb-1.5 font-medium text-ink-primary">Clearing cookies</h2>
                    <p>
                        Logging out clears <span className="font-mono text-xs text-ink-primary">pk_session</span>{' '}
                        and <span className="font-mono text-xs text-ink-primary">pk_csrf</span>. You can forget
                        all remembered devices (clearing every{' '}
                        <span className="font-mono text-xs text-ink-primary">pk_trusted_device</span> grant) from
                        Settings → Two-factor authentication, or clear cookies through your browser's own
                        settings at any time.
                    </p>
                </section>

                <p className="text-xs text-ink-tertiary">
                    See{' '}
                    <Link to="/privacy" className="text-accent hover:text-accent-hover">
                        Privacy Policy
                    </Link>{' '}
                    for how we handle the data behind these cookies.
                </p>
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
