import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * In production builds, add a Content-Security-Policy that forbids sending data to any other
 * server. This is the technical guarantee behind "your statement never leaves your device".
 */
function contentSecurityPolicy(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'openstatement-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

export default defineConfig({
  // Relative paths so the site works on GitHub Pages under any repository name.
  base: './',
  resolve: {
    alias: {
      // Use the library source directly, so `npm run dev` needs no build step.
      openstatement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  plugins: [contentSecurityPolicy()],
  build: { target: 'es2022' },
});
