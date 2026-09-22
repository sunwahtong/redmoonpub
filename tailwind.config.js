/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        rm: {
          bg: '#070506',
          card: 'rgba(20, 9, 14, 0.78)',
          cardHover: 'rgba(30, 12, 20, 0.92)',
          border: 'rgba(140, 32, 58, 0.38)',
          glow: 'rgba(230, 38, 76, 0.65)',
          red: '#e3284e',
          redHover: '#ff2a55',
          muted: '#a8949c'
        }
      },
      fontFamily: {
        heading: ['Cinzel', 'serif'],
        sans: ['Noto Sans', 'sans-serif']
      }
    }
  },
  plugins: []
};