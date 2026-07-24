import { Lock, Unlock } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import { cn } from '../utils/cn.js';

// Reflects the client-side idle lock from VaultLockContext, not raw auth state (this component
// only ever renders while authenticated - see TopBar). "Unlocked" is deliberately the more
// muted state and "locked" the more prominent one: locked is the state that needs the user's
// attention to resume work, not the one to worry about.
export default function SessionStatus({ status = 'unlocked', className }) {
    const isUnlocked = status === 'unlocked';

    return (
        <Badge
            tone={isUnlocked ? 'success' : 'warning'}
            icon={
                isUnlocked ? (
                    <Unlock size={12} aria-hidden="true" />
                ) : (
                    <Lock size={12} aria-hidden="true" />
                )
            }
            className={cn(!isUnlocked && 'font-semibold ring-1 ring-warning/40', className)}
        >
            {isUnlocked ? 'Vault unlocked' : 'Vault locked'}
        </Badge>
    );
}
