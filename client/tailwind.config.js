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
      },
      fontFamily: {
        sans: ['Nunito', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
