import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const playwright = require('playwright');
const name = process.env.ECHO_BROWSER || 'chromium';
const engine = playwright[name];
if (!engine) throw Error('Navegador desconocido: ' + name);
const dataDir = await mkdtemp(join(tmpdir(), 'echo404-cross-'));
const server = spawn('python3', ['-u', 'server.py', '--port', '0', '--data-dir', dataDir], { cwd: resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
const baseURL = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('Tiempo de espera del servidor agotado')), 10000);
  server.stdout.on('data', data => { const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  server.once('exit', code => reject(Error('Servidor terminado: ' + code)));
});
let browser;
try {
  browser = await engine.launch({ headless: true });
  for (const device of [{ name: 'iPhone', width: 390, height: 844 }, { name: 'iPad', width: 820, height: 1180 }, { name: 'Desktop', width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport: device, acceptDownloads: true, isMobile: device.name !== 'Desktop' && name !== 'firefox', hasTouch: device.name !== 'Desktop' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL);
    await page.locator('#record').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('record').disabled);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' ' + device.name + ' overflow');
    await page.locator('#meetingTitle').fill('Prueba ' + name + ' ' + device.name);
    await page.locator('#transcriptTab').click();
    await page.locator('#transcript').fill('Dictado verificable.');
    await page.locator('#saveMeeting').click();
    await page.waitForFunction(() => document.getElementById('saveState').textContent === 'Guardado en SQLite');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('saveState').textContent === 'Guardado en SQLite');
    assert.equal(await page.locator('#transcript').inputValue(), 'Dictado verificable.');
    await page.locator('#transcriptFormat').selectOption('txt');
    const download = page.waitForEvent('download'); await page.locator('#downloadTranscript').click();
    assert.match(await readFile(await (await download).path(), 'utf8'), /Dictado verificable/);
    assert.deepEqual(errors, [], name + ' ' + device.name + ' JS errors');
    console.log('PASS ' + name + ' ' + device.name + ': diseño, guardado, recarga, TXT');
    await context.close();
  }
} finally {
  await browser?.close(); server.kill('SIGTERM'); await once(server, 'exit').catch(() => {});
}
