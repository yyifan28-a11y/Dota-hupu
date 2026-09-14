import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync, backup } from 'node:sqlite';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'dota-upload-test-'));
const db = new DatabaseSync(join(root, 'dota-s3.db'), { readOnly: true });
await backup(db, join(temp, 's3.db'));
db.close();
let child;
const base = 'http://localhost:3012';
const auth = { 'X-Admin-Password': 'upload-test' };
async function start() {
  child = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true,
    env: { ...process.env, PORT: '3012', ADMIN_PASSWORD: 'upload-test',
      S2_DATABASE_PATH: join(temp, 's2.db'), S3_DATABASE_PATH: join(temp, 's3.db'),
      HIGHLIGHT_UPLOAD_DIR: join(temp, 'uploads') }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    child.once('error', reject);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    child.stdout.on('data', (data) => {
      if (String(data).includes('Dota2 inhouse tool running')) { clearTimeout(timer); resolveReady(); }
    });
  });
}
async function stop() {
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
}
try {
  await start();
  const source = await readFile(join(root, 'assets/highlights/ember-spirit-ldxy-2026-05-14-03-v8.webp'));
  const upload = (body, headers = auth) => fetch(`${base}/api/homepage-highlights/upload`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'image/webp' }, body
  });
  assert.equal((await upload(source, {})).status, 401);
  assert.equal((await upload(Buffer.from('<svg></svg>'))).status, 400);
  assert.equal((await upload(Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
  const result = await upload(source);
  assert.equal(result.status, 201);
  const saved = await result.json();
  const image = await fetch(base + saved.image);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  const info = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
  assert.ok(info.width <= 3840 && info.height <= 3840);
  const state = await (await fetch(base + '/api/state')).json();
  const original = state.homepageHighlights.find((item) => item.playerName === 'ldxy');
  const create = await fetch(base + '/api/homepage-highlights', { method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...original, image: saved.image }) });
  assert.equal(create.status, 201);
  const created = await create.json();
  const draft = created.homepageHighlights.find((item) => item.image === saved.image);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.playerId, original.playerId);
  assert.equal(draft.matchRecordId, original.matchRecordId);
  await stop();
  await start();
  assert.equal((await fetch(base + saved.image)).status, 200);
  const restarted = await (await fetch(base + '/api/state')).json();
  assert.ok(restarted.homepageHighlights.some((item) => item.id === draft.id && item.image === saved.image));
  assert.equal((await fetch(base + '/uploads/highlights/not-an-image')).status, 404);
  console.log('PASS: authorization, invalid/oversized rejection, upload, WebP output, linked draft, restart persistence.');
} finally {
  await stop();
  // Only the exact OS-created test directory is removed.
  await rm(temp, { recursive: true, force: true });
}
