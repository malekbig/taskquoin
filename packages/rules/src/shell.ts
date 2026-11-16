/** Heuristic POSIX-ish splitting, enough to find git invocations inside compound commands. Not a shell parser. */
export function splitSegments(command: string): string[] {
  const segs: string[] = []; let cur = ''; let q: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (q) { cur += c; if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < command.length) cur += command[++i]; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < command.length) { cur += c + command[++i]; continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&' || c === '(' || c === ')' || c === '`') { if (cur.trim()) segs.push(cur.trim()); cur = ''; continue; }
    if (c === '$' && command[i + 1] === '(') { if (cur.trim()) segs.push(cur.trim()); cur = ''; i++; continue; }
    cur += c;
  }
  if (cur.trim()) segs.push(cur.trim());
  return segs;
}

export function tokenize(segment: string): string[] {
  const out: string[] = []; let cur = ''; let q: string | null = null; let has = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < segment.length) cur += segment[++i]; else cur += c; continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\' && i + 1 < segment.length) { cur += segment[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (has || cur) out.push(cur);
  return out;
}
