// End-to-end test for the Rheow browser extension.
//
// Launches a real Chrome/Edge profile with the unpacked extension, then drives
// it over the DevTools protocol to verify:
//   1. the service worker registers the download interceptor,
//   2. the health check reaches the running Rheow app,
//   3. the popup reports "Connected",
//   4. a real download is intercepted, cancelled and forwarded to Rheow,
//   5. a normal web page still cannot post to the local bridge.
//
// Usage (Rheow must be running):
//   node scripts/e2e-extension.mjs
//   node scripts/e2e-extension.mjs --browser "C:\path\to\msedge.exe"
//
// Exit codes: 0 = all passed, 1 = a check failed, 2 = setup problem.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

let PORT = 9333;
let BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(import.meta.dirname, '..');
const EXTENSION_DIR = path.join(ROOT, 'extension');

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  // Edge still honours --load-extension; stable Chrome 137+ ignores it.
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A crashed earlier run can leave a browser holding the debug port. Pick the
// first free port so the suite never attaches to a stale instance.
async function pickPort(start = 9333, attempts = 20) {
  for (let candidate = start; candidate < start + attempts; candidate += 1) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(candidate, '127.0.0.1');
    });
    if (free) return candidate;
  }
  throw new Error(`tidak ada port debug yang kosong mulai dari ${start}`);
}

function parseArgs(argv) {
  const idx = argv.indexOf('--browser');
  return idx !== -1 ? argv[idx + 1] : null;
}

function resolveBrowser(explicit) {
  if (!explicit) {
    return BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
  }
  return explicit;
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleLogs = [];
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args || [])
          .map((arg) => arg.value ?? arg.description ?? arg.type)
          .join(' ');
        this.consoleLogs.push(`[${message.params.type}] ${text}`);
        if (process.env.RHEOW_E2E_DEBUG) console.error(`[worker console] ${text}`);
      }
      if (!message.id) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      } else {
        entry.resolve(message.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) {
        entry.reject(new Error('DevTools connection closed'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 20000) {
    const result = await this.send(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
      timeoutMs
    );
    if (result.exceptionDetails) {
      throw new Error(
        `Evaluation failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`
      );
    }
    return result.result?.value;
  }

  close() {
    try {
      this.socket.close();
    } catch {}
  }
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket handshake failed')), {
      once: true,
    });
  });
  const cdp = new Cdp(socket);
  await cdp.send('Runtime.enable');
  return cdp;
}

async function cdpHttp(pathname, method = 'GET') {
  const response = await fetch(`${BASE}${pathname}`, { method });
  if (!response.ok) {
    throw new Error(`${method} ${pathname} -> HTTP ${response.status}`);
  }
  return response.json();
}

// Finds the Rheow service worker specifically. A fresh browser profile can host
// several component extensions, so matching on the URL alone is not enough.
async function findRheowWorker(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let seen = [];
  while (Date.now() < deadline) {
    let targets = [];
    try {
      targets = await cdpHttp('/json/list');
    } catch {}
    seen = targets.filter(
      (target) => target.type === 'service_worker' && target.url.startsWith('chrome-extension://')
    );
    for (const target of seen) {
      let cdp = null;
      try {
        cdp = await connect(target);
        const name = await cdp.evaluate('chrome.runtime.getManifest().name', 4000);
        if (process.env.RHEOW_E2E_DEBUG) {
          console.error(`[e2e] worker ${target.url} -> ${JSON.stringify(name)}`);
        }
        if (name === 'Rheow Download Manager') {
          return { target, cdp, seen };
        }
        cdp.close();
      } catch (error) {
        if (process.env.RHEOW_E2E_DEBUG) {
          console.error(`[e2e] worker ${target.url} -> probe failed: ${error.message}`);
        }
        cdp?.close();
      }
    }
    await sleep(400);
  }
  return { target: null, cdp: null, seen };
}

function printResults(results) {
  const width = Math.max(...results.map((entry) => entry.name.length), 30);
  console.log('');
  for (const entry of results) {
    const label = entry.pass ? 'PASS' : 'FAIL';
    console.log(`${label}  ${entry.name.padEnd(width)}  ${entry.detail}`);
  }
  console.log('');
}

async function openTab(url, timeoutMs = 20000) {
  const target = await cdpHttp(`/json/new?${encodeURIComponent(url)}`, 'PUT');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await cdpHttp('/json/list');
    const live = targets.find((entry) => entry.id === target.id);
    if (live) return live;
    await sleep(200);
  }
  throw new Error(`Tab for ${url} did not appear`);
}

function killProcessTree(proc) {
  if (!proc || proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    proc.once('exit', done);
    setTimeout(done, 5000);
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        proc.kill('SIGTERM');
      }
    } catch {
      resolve();
    }
  });
}

// Some Chromium builds do not resolve Runtime.evaluate(awaitPromise) reliably
// inside extension service workers. Kick off the async work, store the result
// in a global, then poll it with synchronous evaluations instead.
async function evalAsyncPoll(cdp, starter, timeoutMs = 15000) {
  if (process.env.RHEOW_E2E_DEBUG) console.error('[e2e]   starter');
  await cdp.evaluate(`globalThis.__rheowAsync = null; ${starter}; true`);
  if (process.env.RHEOW_E2E_DEBUG) console.error('[e2e]   starter accepted, polling');
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    const value = await cdp.evaluate('globalThis.__rheowAsync');
    attempts += 1;
    if (value !== null && value !== undefined) {
      if (process.env.RHEOW_E2E_DEBUG) console.error(`[e2e]   resolved after ${attempts} polls`);
      return value;
    }
    await sleep(150);
  }
  throw new Error('async evaluation timed out');
}

// Registers fetch/download instrumentation on the service worker. MV3 workers
// can restart between phases, which drops globals and listeners, so this runs
// again before each download phase.
async function instrument(worker) {
  await worker.evaluate(`
    (() => {
      globalThis.__rheowFetchLog = [];
      if (!globalThis.__rheowFetchPatched) {
        const original = globalThis.fetch;
        globalThis.__rheowFetchPatched = true;
        globalThis.fetch = async (...args) => {
          const input = args[0];
          const url = typeof input === 'string' ? input : input && input.url;
          const response = await original(...args);
          globalThis.__rheowFetchLog.push({ url, status: response.status });
          return response;
        };
      }
      globalThis.__rheowDownloads = { created: [], changed: [] };
      chrome.downloads.onCreated.addListener((item) => {
        globalThis.__rheowDownloads.created.push({
          id: item.id,
          filename: item.filename,
          url: item.url
        });
      });
      chrome.downloads.onChanged.addListener((delta) => {
        globalThis.__rheowDownloads.changed.push({
          id: delta.id,
          state: delta.state && delta.state.current,
          error: delta.error && delta.error.current
        });
      });
      return true;
    })()
  `);
}

function getAuthToken() {
  const localApp = process.env.LOCALAPPDATA;
  if (!localApp) return null;
  const authPath = path.join(localApp, 'com.rheow.app', 'browser-extension', 'auth.json');
  try {
    if (existsSync(authPath)) {
      const data = JSON.parse(readFileSync(authPath, 'utf8'));
      return data.token || null;
    }
  } catch {}
  return null;
}

async function main() {
  const browserPath = resolveBrowser(parseArgs(process.argv.slice(2)));
  if (!browserPath) {
    console.error('Chrome/Edge tidak ditemukan. Set CHROME_PATH atau pakai --browser <path>.');
    process.exit(2);
  }

  const token = getAuthToken();
  const healthHeaders = { 'X-Rheow-Client': 'rheow-extension' };
  if (token) healthHeaders['X-Rheow-Token'] = token;

  const health = await fetch('http://127.0.0.1:41789/api/health', {
    headers: healthHeaders,
  }).catch(() => null);
  if (!health || !health.ok) {
    console.error('Rheow tidak berjalan di http://127.0.0.1:41789.');
    console.error('Jalankan aplikasinya dulu, lalu ulangi tes ini.');
    process.exit(2);
  }

  const extensionAuthPath = path.join(EXTENSION_DIR, 'auth.json');
  let cleanExtensionAuth = false;
  if (token && !existsSync(extensionAuthPath)) {
    try {
      writeFileSync(extensionAuthPath, JSON.stringify({ token }), 'utf8');
      cleanExtensionAuth = true;
    } catch {}
  }

  const profileDir = await mkdtemp(path.join(tmpdir(), 'rheow-e2e-'));
  PORT = await pickPort(9333);
  BASE = `http://127.0.0.1:${PORT}`;
  const results = [];
  const record = (name, pass, detail) => {
    results.push({ name, pass, detail: detail ?? '' });
  };

  let chrome;
  // Local fixture that mimics Google Drive: the URL has no file extension and
  // the filename is only hinted by Content-Disposition/MIME type.
  const fixtureBody = Buffer.alloc(4096, 0x52);
  const fixture = http.createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="rheow-e2e-drive"',
      'Content-Length': fixtureBody.length,
      'Cache-Control': 'no-store',
    });
    res.end(fixtureBody);
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const fixturePort = fixture.address().port;

  try {
    chrome = spawn(
      browserPath,
      [
        `--user-data-dir=${profileDir}`,
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        `--remote-debugging-port=${PORT}`,
        '--remote-allow-origins=*',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-background-networking',
        '--disable-features=Translate,OptimizationHints,MediaRouter',
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: false }
    );

    const { target: workerTarget, cdp: probeCdp, seen } = await findRheowWorker();

    if (!workerTarget) {
      const candidates = seen.map((target) => target.url).join(', ') || 'tidak ada';
      record(
        'Ekstensi dimuat oleh browser',
        false,
        `service worker Rheow tidak ditemukan (kandidat: ${candidates})`
      );
      printResults(results);
      throw new Error(
        'service worker Rheow tidak ditemukan. Chrome 137+ memblokir --load-extension; ' +
          'pakai Edge atau Chrome for Testing lewat --browser <path>.'
      );
    }
    probeCdp?.close();
    // Use a fresh debugger session for the actual test, mirroring a normal
    // DevTools attach (the discovery session may have been left half-closed).
    const worker = await connect(workerTarget);
    record('Ekstensi dimuat oleh browser', true, workerTarget.url);

    const debug = process.env.RHEOW_E2E_DEBUG;
    const trace = (label) => {
      if (debug) console.error(`[e2e] ${label}`);
    };

    trace('evaluating chrome.runtime.id');
    const extensionId = await worker.evaluate('chrome.runtime.id');
    record('Service worker aktif', Boolean(extensionId), extensionId);

    trace('checking downloads listener');
    const hasListener = await worker.evaluate(
      'chrome.downloads.onDeterminingFilename.hasListeners()'
    );
    record('Interceptor unduhan terdaftar', hasListener === true, String(hasListener));

    trace('running health check');
    const online = await worker.evaluate('isRheowOnline()');
    record('Health check dari service worker', online === true, String(online));

    trace('posting directly');

    const direct = await evalAsyncPoll(
      worker,
      `
      (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const resp = await fetch('http://127.0.0.1:41789/api/add_download', {
            method: 'POST',
            headers: await bridgeHeaders({
              'Content-Type': 'application/json'
            }),
            body: JSON.stringify({
              url: 'https://example.com/rheow-e2e-direct.zip',
              filename: 'rheow-e2e-direct.zip',
              cookie: null,
              referer: null
            }),
            signal: controller.signal
          });
          return { status: resp.status, body: await resp.text() };
        } catch (error) {
          return { error: String(error) };
        } finally {
          clearTimeout(timer);
        }
      })().then((value) => { globalThis.__rheowAsync = value; })
    `,
      10000
    );
    record(
      'POST langsung dari ekstensi',
      direct?.status === 200 && direct.body.includes('"success":true'),
      direct?.error ? direct.error : `HTTP ${direct?.status}: ${direct?.body}`
    );

    trace('posting batch directly');
    const directBatch = await evalAsyncPoll(
      worker,
      `
      (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const resp = await fetch('http://127.0.0.1:41789/api/add_batch', {
            method: 'POST',
            headers: await bridgeHeaders({
              'Content-Type': 'application/json'
            }),
            body: JSON.stringify({
              urls: ['https://example.com/batch1.zip', 'https://example.com/batch2.zip'],
              referer: 'https://example.com'
            }),
            signal: controller.signal
          });
          return { status: resp.status, body: await resp.text() };
        } catch (error) {
          return { error: String(error) };
        } finally {
          clearTimeout(timer);
        }
      })().then((value) => { globalThis.__rheowAsync = value; })
    `,
      10000
    );
    record(
      'POST batch langsung dari ekstensi',
      directBatch?.status === 200 && directBatch.body.includes('"count":2'),
      directBatch?.error ? directBatch.error : `HTTP ${directBatch?.status}: ${directBatch?.body}`
    );

    // Instrument fetch + download events so the interception path is observable.
    trace('instrumenting');
    await sleep(1000);
    await instrument(worker);
    trace('instrumented');

    trace('opening popup');
    const popupTarget = await openTab(`chrome-extension://${extensionId}/popup.html`);
    const popup = await connect(popupTarget);
    trace('popup connected');
    await sleep(1500);
    const popupStatus = await popup.evaluate(
      "document.getElementById('statusText')?.textContent",
      8000
    );
    trace('popup evaluated');
    record('Popup melaporkan Connected', popupStatus === 'Connected', String(popupStatus));

    try {
      const toggleState = await evalAsyncPoll(
        popup,
        `
        (async () => {
          const toggle = document.getElementById('interceptToggle');
          const before = toggle.checked;
          toggle.click();
          await new Promise((resolve) => setTimeout(resolve, 150));
          const stored = await chrome.storage.local.get(['autoIntercept']);
          toggle.click();
          await new Promise((resolve) => setTimeout(resolve, 150));
          return { before, after: !before, stored: stored.autoIntercept };
        })().then((value) => { globalThis.__rheowAsync = value; })
      `,
        10000
      );
      record(
        'Toggle intersepsi tersimpan',
        toggleState?.stored === toggleState?.after && toggleState?.after !== toggleState?.before,
        JSON.stringify(toggleState)
      );
    } catch (error) {
      record('Toggle intersepsi tersimpan', false, error.message);
    }

    try {
      const snifferToggleState = await evalAsyncPoll(
        popup,
        `
        (async () => {
          const toggle = document.getElementById('snifferToggle');
          const before = toggle.checked;
          toggle.click();
          await new Promise((resolve) => setTimeout(resolve, 150));
          const stored = await chrome.storage.local.get(['mediaSnifferEnabled']);
          toggle.click();
          await new Promise((resolve) => setTimeout(resolve, 150));
          return { before, after: !before, stored: stored.mediaSnifferEnabled };
        })().then((value) => { globalThis.__rheowAsync = value; })
      `,
        10000
      );
      record(
        'Toggle media sniffer tersimpan',
        snifferToggleState?.stored === snifferToggleState?.after &&
          snifferToggleState?.after !== snifferToggleState?.before,
        JSON.stringify(snifferToggleState)
      );
    } catch (error) {
      record('Toggle media sniffer tersimpan', false, error.message);
    }

    try {
      const popupSend = await popup.evaluate(
        `
        (async () => {
          const input = document.getElementById('quickUrl');
          const button = document.getElementById('sendBtn');
          input.value = 'https://example.com/rheow-e2e-popup.zip';
          button.click();
          const deadline = Date.now() + 3000;
          while (Date.now() < deadline) {
            if (['Sent!', 'Failed', 'Offline'].includes(button.textContent)) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return button.textContent;
        })()
      `,
        8000
      );
      record('Quick send dari popup', popupSend === 'Sent!', String(popupSend));
    } catch (error) {
      record('Quick send dari popup', false, error.message);
    }
    popup.close();

    // A normal web page must not be able to reach the bridge.
    trace('opening example.com');
    const webTarget = await openTab('https://example.com/');
    const web = await connect(webTarget);
    trace('web connected');
    await sleep(2000);
    const attack = await web.evaluate(
      `
      (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const resp = await fetch('http://127.0.0.1:41789/api/add_download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://evil.example/payload.zip' }),
            signal: controller.signal
          });
          return { blocked: false, status: resp.status };
        } catch (error) {
          return { blocked: true, error: String(error) };
        } finally {
          clearTimeout(timer);
        }
      })()
    `,
      10000
    );
    record(
      'Halaman web diblokir',
      attack?.blocked === true || attack?.status === 403,
      attack?.blocked ? 'diblokir browser' : `HTTP ${attack?.status}`
    );
    web.close();

    // Trigger a real download of a small .zip; the extension must intercept it.
    await openTab('https://github.com/octocat/Hello-World/archive/refs/heads/master.zip');
    await sleep(6000);

    const traffic = await worker.evaluate('globalThis.__rheowFetchLog');
    const downloads = await worker.evaluate('globalThis.__rheowDownloads');

    const healthHits = (traffic || []).filter((entry) =>
      String(entry.url).includes('/api/health')
    );
    const postHits = (traffic || []).filter((entry) =>
      String(entry.url).includes('/api/add_download')
    );

    record(
      'Health check saat interception',
      healthHits.some((entry) => entry.status === 200),
      JSON.stringify(healthHits)
    );
    record(
      'Unduhan diteruskan ke Rheow',
      postHits.some((entry) => entry.status === 200),
      JSON.stringify(postHits)
    );

    const states = (downloads?.changed || []).map((entry) => entry.state);
    const cancelled = states.includes('interrupted');
    record(
      'Salinan unduhan Chrome dibatalkan',
      cancelled,
      `created=${downloads?.created?.length ?? 0} states=${JSON.stringify(states)}`
    );

    // Mimic a Google Drive download: no extension in the URL, no extension in
    // the filename, so the MIME type is the only signal that this is a file.
    const logStart = worker.consoleLogs.length;
    await instrument(worker);
    await openTab(`http://127.0.0.1:${fixturePort}/download?id=rheow-e2e`);
    await sleep(5000);

    const fixtureTraffic = await worker.evaluate('globalThis.__rheowFetchLog');
    const fixtureHits = (fixtureTraffic || []).filter((entry) =>
      String(entry.url).includes('/download?id=rheow-e2e')
    );
    // Console logs survive a service-worker restart, unlike globals, so they are
    // the primary signal that the handoff happened.
    const fixtureLogs = worker.consoleLogs.slice(logStart);
    const fixtureHandedOff = fixtureLogs.some((line) =>
      line.includes('/download?id=rheow-e2e')
    );
    record(
      'Unduhan tanpa ekstensi (mirip Drive) diteruskan',
      fixtureHandedOff || fixtureHits.some((entry) => entry.status === 200),
      fixtureHandedOff ? 'handoff tercatat' : JSON.stringify(fixtureHits)
    );

    const leftover = await evalAsyncPoll(
      worker,
      `chrome.downloads.search({}).then((items) => { globalThis.__rheowAsync = items; })`
    );
    record(
      'Riwayat unduhan Chrome dibersihkan',
      Array.isArray(leftover) && leftover.length === 0,
      `${leftover?.length ?? '?'} item tersisa`
    );

    worker.close();
  } finally {
    if (cleanExtensionAuth && existsSync(extensionAuthPath)) {
      try { unlinkSync(extensionAuthPath); } catch {}
    }
    killProcessTree(chrome);
    await sleep(1500);
    await new Promise((resolve) => fixture.close(resolve));
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }

  printResults(results);

  const failures = results.filter((entry) => !entry.pass).length;
  if (failures > 0) {
    console.log(`${failures} tes GAGAL.`);
    process.exit(1);
  }
  console.log(`Semua ${results.length} tes lolos.`);
}

main().catch(async (error) => {
  console.error('');
  console.error('E2E error:', error.message);
  process.exit(1);
});
