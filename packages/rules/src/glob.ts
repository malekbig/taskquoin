/** Minimal glob → RegExp for policy paths: `**`, `*`, `?`, literals. Anchored, dotAll (names may contain newlines). Relative paths only. */
const cache = new Map<string, RegExp>();
const strip = (s: string) => s.replace(/^\.\//, '');

export function globToRegExp(glob: string): RegExp {
  const g = strip(glob);
  let re = cache.get(g);
  if (re) return re;
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      const before = i === 0 || g[i - 1] === '/'; const after = g[i + 2] === '/' || i + 2 === g.length;
      if (before && g[i + 2] === '/') { out += '(?:.*/)?'; i += 2; continue; }          // "**/"
      if (before && after && i > 0) { out = out.replace(/\/$/, ''); out += '(?:/.*)?'; i += 1; continue; } // "/**" at end
      out += '.*'; i += 1; continue;                                                    // bare "**"
    }
    if (c === '*') { out += '[^/]*'; continue; }
    if (c === '?') { out += '[^/]'; continue; }
    out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // dotAll: `**` must span a newline inside a path name too, or such a path escapes every policy (Codex CR4).
  re = new RegExp(`^${out}$`, 's');
  cache.set(g, re);
  return re;
}

export function matchGlob(glob: string, relPath: string): boolean {
  return globToRegExp(glob).test(strip(relPath));
}
