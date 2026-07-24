/** @type {import('tailwindcss').Config} */

// Reads colour tokens from CSS custom properties (defined once in src/index.css) so the
// whole palette can be retheme'd from one place. Tokens are stored as space-separated
// "R G B" triplets so Tailwind's opacity modifiers (e.g. `border-danger/30`) keep working.
function withOpacity(variable) {
    return ({ opacityValue }) =>
        opacityValue === undefined ? `rgb(var(${variable}))` : `rgb(var(${variable}) / ${opacityValue})`;
}

export default {
    darkMode: 'class',
    content: ['./index.html', './src/**/*.{js,jsx}'],
    theme: {
        extend: {
            colors: {
                surface: {
                    DEFAULT: withOpacity('--color-surface'),
                    raised: withOpacity('--color-surface-raised'),
                    overlay: withOpacity('--color-surface-overlay'),
                    // Kept as an alias of `--color-border` so existing `border-surface-border`
                    // usage elsewhere in the app keeps resolving unchanged.
                    border: withOpacity('--color-border'),
                },
                line: {
                    DEFAULT: withOpacity('--color-border'),
                    strong: withOpacity('--color-border-strong'),
                },
                ink: {
                    primary: withOpacity('--color-text-primary'),
                    secondary: withOpacity('--color-text-secondary'),
                    tertiary: withOpacity('--color-text-tertiary'),
                },
                accent: {
                    DEFAULT: withOpacity('--color-accent'),
                    hover: withOpacity('--color-accent-hover'),
                    on: withOpacity('--color-on-accent'),
                },
                danger: withOpacity('--color-danger'),
                warning: withOpacity('--color-warning'),
                success: withOpacity('--color-success'),
            },
            fontFamily: {
                sans: 'var(--font-sans)',
                mono: 'var(--font-mono)',
            },
            borderRadius: {
                sm: 'var(--radius-sm)',
                md: 'var(--radius-md)',
                lg: 'var(--radius-lg)',
            },
            transitionDuration: {
                fast: 'var(--transition-fast)',
                base: 'var(--transition-base)',
            },
            boxShadow: {
                panel: '0 1px 0 0 rgb(255 255 255 / 0.03) inset, 0 12px 32px -12px rgb(0 0 0 / 0.55)',
                overlay: '0 24px 64px -16px rgb(0 0 0 / 0.7)',
            },
        },
    },
    plugins: [],
};
