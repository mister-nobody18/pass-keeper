import { AlertTriangle, Clock } from 'lucide-react';
import Badge from './Badge.jsx';
import { ageInDays } from '../../utils/time.js';

const STALE_DAYS = 365;
const AGING_DAYS = 180;

// Flags entries that haven't been touched in a long time. `updatedAt` reflects "last saved",
// which is the closest honest proxy we have to "last rotated" given the data model - it isn't
// a guarantee the password itself changed on that save, just that the entry was.
export default function AgeBadge({ updatedAt, className }) {
    const days = ageInDays(updatedAt);
    if (days < AGING_DAYS) return null;

    const stale = days >= STALE_DAYS;
    const years = (days / 365).toFixed(1);

    return (
        <Badge
            tone={stale ? 'danger' : 'warning'}
            icon={stale ? <AlertTriangle size={12} aria-hidden="true" /> : <Clock size={12} aria-hidden="true" />}
            className={className}
        >
            {stale ? `Not updated in ${years}y` : `Aging (${days}d)`}
        </Badge>
    );
}
