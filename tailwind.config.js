/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Refined cool-neutral dark palette
        ink: {
          950: '#0a0b0e',
          900: '#101218',
          850: '#14161d',
          800: '#191c24',
          700: '#272b36',
          600: '#3b4150',
        },
        line: '#262a35',
        code: '#0c0e13',
        accent: {
          DEFAULT: '#7c8cff',
          soft: '#5566d6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
