/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.ts'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      keyframes: {
        rise: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        ping2: { '0%': { transform: 'scale(1)', opacity: '0.7' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        bars: { '0%,100%': { transform: 'scaleY(0.35)' }, '50%': { transform: 'scaleY(1)' } },
      },
      animation: {
        rise: 'rise .35s ease-out both',
        ping2: 'ping2 1.4s cubic-bezier(0,0,.2,1) infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        bars: 'bars 1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
