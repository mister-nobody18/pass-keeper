const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(isoString) {
    const then = new Date(isoString).getTime();
    if (Number.isNaN(then)) return '';
    const diffMs = Date.now() - then;
    if (diffMs < MINUTE) return 'just now';
    if (diffMs < HOUR) return `${Math.round(diffMs / MINUTE)}m ago`;
    if (diffMs < DAY) return `${Math.round(diffMs / HOUR)}h ago`;
    const days = Math.round(diffMs / DAY);
    if (days < 30) return `${days}d ago`;
    const months = Math.round(days / 30);
    if (months < 24) return `${months}mo ago`;
    return `${Math.round(months / 12)}y ago`;
}

export function formatAbsoluteDate(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ageInDays(isoString) {
    const then = new Date(isoString).getTime();
    if (Number.isNaN(then)) return 0;
    return Math.floor((Date.now() - then) / DAY);
}

export function formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
