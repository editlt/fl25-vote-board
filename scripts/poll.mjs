// Checks the county pages every 5 seconds. When counts change it writes
// public/results.json and asks GitHub to redeploy the site.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { SOURCES, read } from './results-lib.mjs';

const STOP_AT = Date.now() + 340 * 60 * 1000;
const HEARTBEAT = 5 * 60 * 1000;
const MIN_GAP = 30 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => execSync(c, { stdio: 'inherit' });
let lastSig = '';
let lastPublish = 0;
let dirty = false;

while (Date.now() < STOP_AT) {
  const entries = await Promise.all(SOURCES.map(read));
  const counties = SOURCES.map((s, i) => ({
    code: s.code,
    name: s.name,
    sourceUrl: s.url,
    ...(entries[i].data || {}),
    hasData: !!entries[i].data,
    updated: entries[i].updated || null,
    readAt: entries[i].readAt ? new Date(entries[i].readAt).toISOString() : null,
    error: entries[i].error || null,
  }));
  const sig = JSON.stringify(counties.map((c) => [c.hasData, c.moskowitz, c.singer, c.jassenoff, c.writein, c.info, !!c.error]));
  if (sig !== lastSig) dirty = true;
  lastSig = sig;
  const now = Date.now();
  if ((dirty && now - lastPublish >= MIN_GAP) || now - lastPublish >= HEARTBEAT) {
    console.log(new Date().toISOString(), JSON.stringify(counties.map((c) => [c.code, c.hasData, c.moskowitz, c.singer, c.error])));
    writeFileSync('public/results.json', JSON.stringify({ servedAt: new Date().toISOString(), counties }));
    try {
      sh('git add public/results.json');
      sh('git -c user.name=fl25-bot -c user.email=fl25-bot@users.noreply.github.com commit -q -m "Update counts" || true');
      sh('git pull -q --rebase origin main && git push -q origin main');
      sh('gh workflow run deploy.yml --ref main');
      lastPublish = now;
      dirty = false;
    } catch (e) {
      console.error('publish failed', e.message);
    }
  }
  await sleep(5000);
}
