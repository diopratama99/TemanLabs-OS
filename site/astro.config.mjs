import { defineConfig } from 'astro/config'

// The site's public address, for canonical links and social previews (SITE_URL=https://… at build).
export default defineConfig({
  site: process.env.SITE_URL || undefined,
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  compressHTML: true,
})
