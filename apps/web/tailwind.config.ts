import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0A1628',
        ink: '#06101F',
        teal: { DEFAULT: '#14B8A6', dark: '#0D9488', glow: '#5EEAD4' },
        ice: '#E0F2FE',
        paper: '#F8FAFC',
        slate: { DEFAULT: '#475569', light: '#94A3B8' },
        alert: '#EF4444',
        warn: '#F59E0B',
        ok: '#10B981',
      },
      fontFamily: {
        serif: ['Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(94,234,212,0.3), 0 8px 32px -8px rgba(20,184,166,0.45)',
        ring: '0 0 0 1px rgba(94,234,212,0.5)',
      },
      animation: {
        pulse_slow: 'pulse 3.6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
export default config;
