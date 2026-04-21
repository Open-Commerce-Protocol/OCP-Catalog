import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#161412',
        paper: '#f3f1eb',
        ember: '#db4c31',
        spruce: '#1c7c72',
        brass: '#bc8f2f',
        fog: '#d8dbd2',
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        display: ['"Instrument Serif"', 'serif'],
      },
      boxShadow: {
        card: '0 18px 42px rgba(22, 20, 18, 0.08)',
      },
      backgroundImage: {
        grid: 'linear-gradient(rgba(22,20,18,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(22,20,18,0.08) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
} satisfies Config;
