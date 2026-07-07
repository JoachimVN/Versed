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
          teal: '#00a6a3',
          navy: '#3c2c66',
          purple: '#9e12cc',
          accent: '#9e12cc',
          satin: 'rgba(128,74,146,0.5)',
        },
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(90deg, #00a6a3 0%, #3c2c66 50%, #9e12cc 100%)',
      },
      fontFamily: {
        sans: ['Nunito', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
