/**
 * Resolves a path inside `public/` against the deployment's base URL.
 *
 * Vite rewrites asset references it can see at build time (imports, CSS
 * `url()`, HTML attributes), but paths built as plain strings in JS — the ad
 * board icons, the ball, the 3D stadium model and its textures — are opaque
 * to it. Hard-coding a leading "/" pins those to the domain root, which is
 * correct on Vercel but 404s on a GitHub Pages project site served from
 * `/<repo>/`.
 *
 *   asset('assets/icons/ball.webp')
 *     base "/"        → /assets/icons/ball.webp
 *     base "/repo/"   → /repo/assets/icons/ball.webp
 */
export function asset(path) {
  const base = import.meta.env.BASE_URL || '/';
  return base.replace(/\/+$/, '') + '/' + String(path).replace(/^\/+/, '');
}
