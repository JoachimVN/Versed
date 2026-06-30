/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          900: '#0d0d1a',
          800: '#12122a',
          700: '#1a1a3e',
        },
        answer: {
          red: '#e74c3c',
          blue: '#2980b9',
          yellow: '#f39c12',
          green: '#27ae60',
        },
        brand: {
          teal: '#00807e',
          navy: '#342758',
          purple: '#6e209b',
          accent: '#9611c1',
          satin: 'rgba(128,74,146,0.5)',
        },
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(90deg, #00807e 0%, #342758 50%, #6e209b 100%)',
      },
      fontFamily: {
        sans: ['Nunito', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
