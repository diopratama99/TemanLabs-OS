// Builds the try-it demo: TemanLabsOS itself on sample data (`vite --mode mock`), served by the
// website at /demo/. Everything runs in the visitor's browser; there is no server behind it.
//
//   npm run build:demo     → site/demo-dist (not in git; the Docker image copies it in)
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const out = join(here, '..', 'demo-dist')

execSync(`npx vite build --mode mock --base /demo/ --outDir "${out}" --emptyOutDir`, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, MSYS_NO_PATHCONV: '1' },
})

// Not installable (its manifest would open the real app's address), not for search engines, and
// a small note that it's sample data, with the way back.
const page = join(out, 'index.html')
let html = readFileSync(page, 'utf8')
html = html.replace(/\s*<link rel="manifest"[^>]*>/, '').replace('<head>', '<head>\n    <meta name="robots" content="noindex" />')
const note = `
    <a id="tl-demo-note" href="/" title="Back to the TemanLabsOS website">
      <b>Demo</b><span>Sample data · nothing here is real</span><i>temanlabsos ↗</i>
    </a>
    <style>
      #tl-demo-note { position: fixed; z-index: 2147483000; left: 50%; top: 38px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
        padding: 7px 12px 7px 8px; border-radius: 999px; font: 500 12.5px/1 Inter, system-ui, sans-serif; color: #fff; text-decoration: none;
        background: rgba(4, 18, 43, 0.78); box-shadow: 0 0 0 1px rgba(255,255,255,0.14), 0 8px 24px rgba(0,0,0,0.3);
        -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
      #tl-demo-note b { padding: 4px 8px; border-radius: 999px; font-weight: 700; background: #0479ff; }
      #tl-demo-note i { font-style: normal; opacity: 0.6; }
      #tl-demo-note:hover i { opacity: 1; }
      [data-shell='mobile'] #tl-demo-note { display: none; }
    </style>
  </body>`
html = html.replace('</body>', note)
writeFileSync(page, html)
console.log(`demo: ${out}`)
