import { Search } from 'lucide-react';

export default function SearchBar({ value, onChange }) {
    return (
        <div className="relative flex-1">
            <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
                aria-hidden="true"
            />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Search platforms"
                aria-label="Search platforms"
                className="w-full rounded-md border border-line bg-surface-raised py-2 pl-9 pr-3 text-sm text-ink-primary placeholder:text-ink-tertiary transition-colors duration-fast hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            />
        </div>
    );
}
