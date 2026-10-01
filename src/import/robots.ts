/**
 * Minimal robots.txt support (RFC 9309 subset): User-agent groups, Allow/Disallow with
 * `*` and `$`, longest match wins, Allow wins ties.
 */
interface Rule {
  allow: boolean;
  pattern: string;
}

export function parseRobots(text: string, userAgent: string): Rule[] {
  const ua = userAgent.toLowerCase();
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: field === 'allow', pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

export function isAllowed(rules: Rule[], url: string): boolean {
  const u = new URL(url);
  const path = u.pathname + u.search;
  let best: Rule | undefined;
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

export type RobotsVerdict = { checked: true; allowed: boolean } | { checked: false; reason: string };

/** Returns `checked:false` when robots.txt cannot be read (e.g. CORS in the browser). */
export async function checkRobots(
  url: string,
  userAgent: string,
  fetchText: (url: string) => Promise<{ status: number; text: string }>,
): Promise<RobotsVerdict> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { checked: false, reason: 'invalid URL' };
  }
  try {
    const res = await fetchText(`${origin}/robots.txt`);
    if (res.status === 404 || res.status === 410) return { checked: true, allowed: true };
    if (res.status >= 400) return { checked: false, reason: `robots.txt returned HTTP ${res.status}` };
    return { checked: true, allowed: isAllowed(parseRobots(res.text, userAgent), url) };
  } catch {
    return { checked: false, reason: 'robots.txt could not be read from here' };
  }
}
