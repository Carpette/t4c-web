/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./client/**/*.html",
    "./client/**/*.js",
  ],
  theme: {
    extend: {
      colors: {
        't4c-main-bg': '#14101e',
        't4c-box-bg': '#1a1428',
        't4c-border': '#5a4a8a',
        't4c-text': '#d8d0f0',
        't4c-text-light': '#e8e0ff',
        't4c-gold': '#c8b87a',
        't4c-button': '#4a3a7a',
        't4c-button-hover': '#5d4a98',
        't4c-button-active': '#7a5ac8',
        't4c-input-bg': '#0c0a16',
        't4c-input-border': '#4a4070',
      }
    },
  },
  plugins: [],
}
