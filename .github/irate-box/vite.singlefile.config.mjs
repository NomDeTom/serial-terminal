// The Irate-Box hub's second build of the serial terminal: one self-contained HTML file to
// download and open from disk. Web Serial needs a secure context, which a page opened from
// file:// is and the hub's plain-HTTP /serial/ is not, so this is how live USB works with the
// box. Used only by .github/workflows/irate-box-bundle.yml (vite-plugin-singlefile is
// installed there with --no-save); the project's own build is untouched.
// No PWA plugin: a service worker cannot register from file://. No eslint: the main build lints.
import { readFileSync } from 'node:fs'
import { viteSingleFile } from 'vite-plugin-singlefile'

const dataUrl = (file, type) =>
  `data:${type};base64,${readFileSync(new URL(`../../public/${file}`, import.meta.url)).toString('base64')}`

// From file:// the page cannot fetch its public/ files, so the two small ones go inline as
// data: URLs (which fetch and <img> both accept there). The device photos (4.6 MB) stay out,
// and their slot is hidden rather than shown broken.
const inlinePublic = {
  name: 'irate-box-inline-public',
  enforce: 'pre',
  transform(code, id) {
    if (!/\/src\/[^/]+\.ts$/.test(id)) return null
    return code
      .replace("'/data/hardware-list.json'", JSON.stringify(dataUrl('data/hardware-list.json', 'application/json')))
      .replace('src="/images/world-land.svg"', `src="${dataUrl('images/world-land.svg', 'image/svg+xml')}"`)
  },
  transformIndexHtml(html) {
    return html.replace('</head>', '<style>.device-img { display: none; }</style></head>')
  },
}

export default {
  base: './',
  publicDir: false,
  plugins: [inlinePublic, viteSingleFile()],
  build: {
    outDir: process.env.SINGLEFILE_OUT || 'dist-single',
    emptyOutDir: true,
  },
}
