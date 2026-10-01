// GitHub Pages SPA fallback: unknown paths are served 404.html, which is the app shell itself.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
const dist = new URL('../dist/', import.meta.url);
if (existsSync(new URL('index.html', dist))) {
  copyFileSync(new URL('index.html', dist), new URL('404.html', dist));
  writeFileSync(new URL('.nojekyll', dist), '');
  console.log('postbuild: wrote 404.html (SPA fallback) and .nojekyll');
}
