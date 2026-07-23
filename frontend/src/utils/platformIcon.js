const PALETTE = [
    '#1f2937', // slate/near-black (e.g. GitHub)
    '#dc2626', // red (e.g. Gmail)
    '#16a34a', // green (e.g. Spotify)
    '#ea580c', // orange (e.g. Amazon)
    '#2563eb', // blue
    '#7c3aed', // purple
    '#0d9488', // teal
    '#db2777', // pink
];

export function getInitials(name) {
    if (!name) return '?';
    const trimmed = name.trim();
    return trimmed.slice(0, 2).toUpperCase();
}

export function getColorForName(name) {
    if (!name) return PALETTE[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return PALETTE[hash % PALETTE.length];
}
