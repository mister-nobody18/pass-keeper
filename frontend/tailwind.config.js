/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: ['./index.html', './src/**/*.{js,jsx}'],
    theme: {
        extend: {
            colors: {
                surface: {
                    DEFAULT: '#13151a',
                    raised: '#1b1e26',
                    border: '#2a2e38',
                },
            },
        },
    },
    plugins: [],
};
