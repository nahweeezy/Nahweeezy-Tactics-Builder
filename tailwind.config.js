/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './tactics.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display:   ['"Uni Sans Heavy"', '"Bebas Neue"', 'sans-serif'],
        stencil:   ['"Bebas Neue"', 'sans-serif'],
        accent:    ['Oswald', 'sans-serif'],
        grotesk:   ['"Space Grotesk"', 'sans-serif'],
        mono:      ['"JetBrains Mono"', 'monospace'],
        sans:      ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
