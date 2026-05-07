import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Anton', 'Impact', 'sans-serif'],
        body: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: '#0A0A0A',
        surface: '#161616',
        elevated: '#1F1F1F',
        line: '#2A2A2A',
        bone: '#F5F2EA',
        muted: '#7A7A7A',
        // Keep app accent distinct from Strava brand orange (#FC4C02).
        flame: '#3B82F6',
        ember: '#60A5FA',
        live: '#00D26A',
        heart: '#FF3B47',
        gold: '#FFC93C',
      },
      animation: {
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        'flicker': 'flicker 1.6s ease-in-out infinite',
        'pop-in': 'popIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'fill-bar': 'fillBar 1.2s cubic-bezier(0.22, 1, 0.36, 1) forwards',
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { opacity: '0.95' },
          '50%': { opacity: '0.6' },
        },
        flicker: {
          '0%, 100%': { transform: 'translateY(0) scale(1)', opacity: '1' },
          '50%': { transform: 'translateY(-1px) scale(1.04)', opacity: '0.92' },
        },
        popIn: {
          '0%': { transform: 'scale(0.7)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        fillBar: {
          '0%': { width: '0%' },
          '100%': { width: 'var(--fill, 0%)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
