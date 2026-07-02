import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Explicit because the folder is "Public" (capital P) on disk. Vite's default
  // is lowercase "public" — macOS's case-insensitive filesystem hides the
  // mismatch locally, but Vercel's Linux build servers are case-sensitive and
  // would silently skip the folder without this.
  publicDir: 'Public',
})
