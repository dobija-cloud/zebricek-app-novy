// vite.config.js
/* import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './', // změna na relativní cestu
  plugins: [react()],
}); */


// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // app poběží na https://(www.)testuji.cz/dist/
  base: '/dist/', // ZDE MENIT SLOZKU NA HOSTINGU, 
})
