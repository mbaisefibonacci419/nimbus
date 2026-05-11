/** @type {import('tailwindcss').Config} */

function cssVar(name) {
  return `rgb(var(--${name}) / <alpha-value>)`;
}

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        slate: {
          50:  cssVar('slate-50'),
          100: cssVar('slate-100'),
          200: cssVar('slate-200'),
          300: cssVar('slate-300'),
          400: cssVar('slate-400'),
          500: cssVar('slate-500'),
          600: cssVar('slate-600'),
          700: cssVar('slate-700'),
          800: cssVar('slate-800'),
          900: cssVar('slate-900'),
          950: cssVar('slate-950'),
        },
        surface: {
          900: cssVar('surface-900'),
          800: cssVar('surface-800'),
          700: cssVar('surface-700'),
          600: cssVar('surface-600'),
        },
        primary: {
          50:  cssVar('primary-50'),
          100: cssVar('primary-100'),
          200: cssVar('primary-200'),
          300: cssVar('primary-300'),
          400: cssVar('primary-400'),
          500: cssVar('primary-500'),
          600: cssVar('primary-600'),
          700: cssVar('primary-700'),
          800: cssVar('primary-800'),
          900: cssVar('primary-900'),
        },
        // Legacy aliases — all resolve to the primary scale
        'nimbus-emerald': {
          50:  cssVar('primary-50'),
          100: cssVar('primary-100'),
          200: cssVar('primary-200'),
          300: cssVar('primary-300'),
          400: cssVar('primary-400'),
          500: cssVar('primary-500'),
          600: cssVar('primary-600'),
          700: cssVar('primary-700'),
          800: cssVar('primary-800'),
          900: cssVar('primary-900'),
        },
        'nimbus-violet': {
          50:  cssVar('primary-50'),
          100: cssVar('primary-100'),
          200: cssVar('primary-200'),
          300: cssVar('primary-300'),
          400: cssVar('primary-400'),
          500: cssVar('primary-500'),
          600: cssVar('primary-600'),
          700: cssVar('primary-700'),
          800: cssVar('primary-800'),
          900: cssVar('primary-900'),
        },
        telos: {
          orange: {
            50:  cssVar('primary-50'),
            100: cssVar('primary-100'),
            200: cssVar('primary-200'),
            300: cssVar('primary-300'),
            400: cssVar('primary-400'),
            500: cssVar('primary-500'),
            600: cssVar('primary-600'),
            700: cssVar('primary-700'),
            800: cssVar('primary-800'),
            900: cssVar('primary-900'),
          },
          blue: {
            50:  cssVar('primary-50'),
            100: cssVar('primary-100'),
            200: cssVar('primary-200'),
            300: cssVar('primary-300'),
            400: cssVar('primary-400'),
            500: cssVar('primary-500'),
            600: cssVar('primary-600'),
            700: cssVar('primary-700'),
            800: cssVar('primary-800'),
            900: cssVar('primary-900'),
          },
        },
        // Semantic tokens
        success: {
          400: cssVar('success-400'),
          500: cssVar('success-500'),
          600: cssVar('success-600'),
        },
        warning: {
          400: cssVar('warning-400'),
          500: cssVar('warning-500'),
          600: cssVar('warning-600'),
        },
      },
      fontSize: {
        xxs: ['0.625rem', { lineHeight: '0.875rem' }],
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      maxWidth: {
        wizard: '720px',
      },
    },
  },
  plugins: [],
};
