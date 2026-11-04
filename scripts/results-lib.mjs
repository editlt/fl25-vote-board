// Reads the three county results pages and returns FL-25 counts as JSON.
// Each page is checked with a HEAD request and only downloaded when it changes.
// The CDN cache header means all viewers share one read every 5 seconds.
export const SOURCES = [
  { code: 'PAL', name: 'Palm Beach', url: 'https://enr.electionsfl.org/PAL/4131/Summary/', parse: parseEnr },
  { code: 'BRO', name: 'Broward', url: 'https://results.browardvotes.gov/ENR/browardflenr/240/en/Index_240.html', parse: parseBroward },
  { code: 'DAD', name: 'Miami-Dade', url: 'https://enr.electionsfl.org/DAD/4087/Summary/', parse: parseEnr },
];
const memo = new Map();

export function strip(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#37;/g, '%')
    .replace(/\s+/g, ' ');
}

function number(block, re) {
  const m = block.match(re);
  if (!m) throw new Error('Candidate row missing');
  return Number(m[1].replace(/,/g, ''));
}

export function parseEnr(html) {
  const text = strip(html);
  const at = text.search(/Representative (?:in )?Congress,? District 25/);
  if (at < 0) throw new Error('District 25 not found');
  const b = text.slice(at, at + 1500);
  const precincts = b.match(/Precincts Reporting: ([\d,]+) ?\/ ?([\d,]+)/);
  return {
    singer: number(b, /Scott Singer \(REP\) [\d.]+ ?% ([\d,]+)/),
    moskowitz: number(b, /Jared Moskowitz \(DEM\) [\d.]+ ?% ([\d,]+)/),
    jassenoff: number(b, /Peter Jassenoff \(LPF\) [\d.]+ ?% ([\d,]+)/),
    writein: number(b, /Write-in [\d.]+ ?% ([\d,]+)/),
    info: precincts ? `Precincts reporting in FL-25: ${precincts[1]} of ${precincts[2]}` : '',
  };
}

export function parseBroward(html) {
  let i = -1;
  let b = null;
  while ((i = html.indexOf('Representative in Congress, District 25', i + 1)) >= 0) {
    const t = strip(html.slice(i, i + 12000));
    if (/^.{0,160}Candidate Name\s+Total Votes\s+Percentage/.test(t)) { b = t; break; }
  }
  if (!b) throw new Error('District 25 summary not found');
  const head = strip(html.slice(0, 300000));
  const part = (re) => (head.match(re) || [])[1]?.trim();
  const mail = part(/Vote By Mail:\s*([A-Za-z ]+?)\s+Early/);
  const early = part(/Early Votes:\s*([A-Za-z ]+?)\s+Election Day/);
  return {
    singer: number(b, /Scott Singer\s+([\d,]+)\s+[\d.]+%/),
    moskowitz: number(b, /Jared Moskowitz\s+([\d,]+)\s+[\d.]+%/),
    jassenoff: number(b, /Peter Jassenoff\s+([\d,]+)\s+[\d.]+%/),
    writein: number(b, /Write-in\s+([\d,]+)\s+[\d.]+%/),
    info: mail || early ? `Countywide reporting: mail ${mail || 'unknown'}, early ${early || 'unknown'}` : '',
  };
}

export async function read(source) {
  const prior = memo.get(source.code);
  try {
    const headers = { 'user-agent': 'fl25-vote-board' };
    const head = await fetch(source.url, { method: 'HEAD', headers });
    if (!head.ok) throw new Error(`HTTP ${head.status}`);
    const tag = `${head.headers.get('etag') || ''}|${head.headers.get('last-modified') || ''}`;
    if (prior?.data && tag !== '|' && tag === prior.tag) {
      prior.readAt = Date.now();
      prior.error = null;
      return prior;
    }
    const res = await fetch(source.url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const entry = {
      tag,
      data: source.parse(await res.text()),
      updated: head.headers.get('last-modified'),
      readAt: Date.now(),
      error: null,
    };
    memo.set(source.code, entry);
    return entry;
  } catch (e) {
    const entry = { ...(prior || {}), error: String(e.message || e) };
    memo.set(source.code, entry);
    return entry;
  }
}

