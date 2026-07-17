/** @type {import('tailwindcss').Config} */
// Color tokens resolve through CSS variables (RGB triples) so the four themes
// — volt (default), blue (legacy), light, dark — swap by re-declaring vars.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: [
    './index.html',
    './tactics.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink:       v('--ink-rgb'),      // primary text
        mute:      v('--mute-rgb'),     // secondary text
        dim:       v('--dim-rgb'),      // tertiary text
        accent:    v('--accent-rgb'),   // brand accent (volt / blue / …)
        'acc-ink': v('--acc-ink-rgb'),  // text ON accent surfaces
        s1:        v('--s1-rgb'),       // chrome surface (bars, rails)
        s2:        v('--s2-rgb'),       // raised surface (modals)
        well:      v('--well-rgb'),     // input wells
      },
      boxShadow: {
        glow:      '0 0 16px rgb(var(--accent-rgb) / 0.35)',
        'glow-lg': '0 0 30px rgb(var(--accent-rgb) / 0.45)',
      },
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
