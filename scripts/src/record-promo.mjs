// Re-records the promo animation (artifacts/promo-video) into the marketing
// site's embedded mp4 (artifacts/www/public/media/promo.mp4).
// Usage (from repo root, with the promo-video workflow running):
//   cd scripts && CHROMIUM_PATH=$(which chromium) node src/record-promo.mjs
// Requires: npx playwright install ffmpeg (one-time, for webm muxing).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const URL = 'http://127.0.0.1:80/promo-video/';
const OUT_DIR = '/tmp/promo-record';
const TOTAL_MS = 60000;
const MUSIC = resolve(ROOT, 'artifacts/promo-video/public/audio/bg_music.mp3');
const FINAL = resolve(ROOT, 'artifacts/www/public/media/promo.mp4');

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(resolve(ROOT, 'artifacts/www/public/media'), { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: OUT_DIR, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();

let startAt = null;
let stopAt = null;
await page.exposeFunction('startRecording', () => { startAt = Date.now(); console.log('startRecording fired'); });
await page.exposeFunction('stopRecording', () => { stopAt = Date.now(); console.log('stopRecording fired'); });

const openedAt = Date.now();
await page.goto(URL, { waitUntil: 'load' });

for (let i = 0; i < 200 && !startAt; i++) await page.waitForTimeout(100);
if (!startAt) throw new Error('startRecording never fired — is the promo-video workflow running?');

for (let i = 0; i < (TOTAL_MS + 30000) / 250 && !stopAt; i++) await page.waitForTimeout(250);
if (!stopAt) throw new Error('stopRecording never fired');
await page.waitForTimeout(500);

const video = page.video();
await context.close();
const rawPath = await video.path();
await browser.close();

const startOffsetSec = ((startAt - openedAt) / 1000).toFixed(3);
const durationSec = ((stopAt - startAt) / 1000).toFixed(3);
console.log({ rawPath, startOffsetSec, durationSec });

execFileSync('ffmpeg', [
  '-y',
  '-ss', String(startOffsetSec),
  '-i', rawPath,
  '-i', MUSIC,
  '-t', String(durationSec),
  '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k',
  '-af', 'volume=0.9',
  '-movflags', '+faststart',
  FINAL,
], { stdio: 'inherit' });

console.log('Wrote', FINAL);
