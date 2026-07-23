export default function SearchBar({ value, onChange }) {
    return (
        <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">🔍</span>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Search platforms"
                className="w-full rounded-lg bg-surface-raised border border-surface-border pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
        </div>
    );
}
