// ARTEX desktop shell — one native window, no browser, no separate splash.
//
// The Endfield opening sequence lives INSIDE the web app (src/components/boot-sequence.tsx),
// so the window never swaps content: it is created hidden, the local service is
// started and waited for, the app URL is loaded, and the window is shown on
// first paint - the boot overlay is already part of that paint.
//
// If the local stack cannot come up (missing MSVC runtime for the portable
// PostgreSQL, a non-ASCII install path, a busy port, a blocked postgres.exe...)
// the shell loads diagnose.html instead of leaving the user with a black
// window: the page names the failing step and the remedy.
//
// Responsibilities:
//   1. start the portable PostgreSQL cluster (output goes to a FILE, never a
//      pipe: the postgres child inherits a pipe's write end and a pipe read
//      would never see EOF - the trap documented in the handover)
//   2. start artex.exe with the LLM settings from artex-llm.env
//   3. poll /api/health, then load the app and reveal the window
//   4. keep the upstream watchdog contract for the ARTEX child:
//      exit 0 -> quit, 75 -> restart at once (in-page update), other -> backoff
'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu, screen, Notification } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

// Debug aid: a packaged build can expose the Chrome DevTools Protocol when the
// environment asks for it (ARTEX_DEBUG_PORT=9333). This is how the live preference
// state gets inspected without rebuilding; it is inert unless the variable is set.
if (process.env.ARTEX_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', String(process.env.ARTEX_DEBUG_PORT));
}

// --------------------------------------------------------------------- paths
// Layouts this shell supports:
//   dev            ARTEX_DIR points at the app folder
//   portable exe   PORTABLE_EXECUTABLE_DIR is the folder holding the exe
//   installed      extraResources land in <install>\resources\{artex,pgsql},
//                  so the payload is <resources>\artex and PostgreSQL sits in
//                  <resources>\pgsql with its cluster beside it
// A folder deployment may also drop a shell.json next to the exe.
const EXE_DIR = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
const RESOURCES = process.resourcesPath || path.join(EXE_DIR, 'resources');

function readShellConf(dir) {
  const candidates = [dir, RESOURCES, process.env.ARTEX_DIR].filter(Boolean);
  for (const c of candidates) {
    try {
      return JSON.parse(fs.readFileSync(path.join(c, 'shell.json'), 'utf8'));
    } catch {
      /* keep looking */
    }
  }
  return {};
}

const SHELL_CONF = readShellConf(EXE_DIR);
const CONF_APP_DIR = SHELL_CONF.appDir ? path.resolve(EXE_DIR, SHELL_CONF.appDir) : undefined;

// The app folder is the first candidate that actually contains artex.exe.
const APP_DIR =
  [
    process.env.ARTEX_DIR,
    CONF_APP_DIR,
    path.join(RESOURCES, 'artex'), // installed layout
    EXE_DIR,
  ].find((p) => p && fs.existsSync(path.join(p, 'artex.exe'))) || EXE_DIR;

// The PostgreSQL root is the first candidate that holds pgsql\bin\pg_ctl.exe.
const PG_ROOT =
  [
    process.env.ARTEX_PG_ROOT,
    SHELL_CONF.pgRoot ? path.resolve(EXE_DIR, SHELL_CONF.pgRoot) : undefined,
    RESOURCES, // installed layout: <resources>\pgsql
    path.dirname(APP_DIR), // folder layout: payload\artex + payload\pgsql
    'D:\\artex-pg2',
  ].find((p) => p && fs.existsSync(path.join(p, 'pgsql', 'bin', 'pg_ctl.exe'))) || 'D:\\artex-pg2';

// Ports are only PREFERENCES here: boot() re-picks them around a busy port so a
// single occupied port can never end in a window that never loads.
const PREF_PORT = Number(process.env.ARTEX_PORT || SHELL_CONF.port || 8787);
const PREF_DB_PORT = Number(process.env.ARTEX_DB_PORT || SHELL_CONF.dbPort || 5433);
const PREF_PROXY_PORT = Number(process.env.ARTEX_PROXY_PORT || SHELL_CONF.proxyPort || 8788);
const DB_USER = process.env.ARTEX_DB_USER || SHELL_CONF.dbUser || 'artex';
let PORT = PREF_PORT;
let DB_PORT = PREF_DB_PORT;
let PROXY_PORT = PREF_PROXY_PORT;
let APP_URL = `http://127.0.0.1:${PORT}`;
// The icon must travel INSIDE the app (packaged into app.asar), otherwise the
// window falls back to the exe icon. build/icon.ico is the authoring copy.
const ICON_ICO = fs.existsSync(path.join(__dirname, 'icon.ico'))
  ? path.join(__dirname, 'icon.ico')
  : path.join(__dirname, 'build', 'icon.ico');
const ARTEX_LOG = path.join(APP_DIR, 'artex.log');
const SHELL_LOG = path.join(APP_DIR, 'shell.log');

let mainWin = null;
let artexChild = null;
let quitting = false;
let restartDelay = 1000;
let diagState = null;

// ------------------------------------------------------------------- helpers
function logLine(msg) {
  const line = `${new Date().toISOString()} [shell] ${msg}\n`;
  try {
    fs.appendFileSync(SHELL_LOG, line);
  } catch {
    /* ignore */
  }
  process.stdout.write(line);
}

function portOpen(port, timeout = 1200) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, '127.0.0.1');
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      try {
        srv.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    srv.once('error', () => done(false));
    srv.once('listening', () => done(true));
    srv.listen(port, '127.0.0.1');
  });
}

// Prefer the requested port, otherwise the next free one in a small window.
async function choosePort(pref, label) {
  for (let p = pref; p < pref + 20; p += 1) {
    if (await portFree(p)) {
      if (p !== pref) logLine(`${label} port ${pref} is busy - falling back to ${p}`);
      return p;
    }
  }
  logLine(`${label} port ${pref}..${pref + 19} are all busy`);
  return pref;
}

async function waitPort(port, limitMs) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return portOpen(port);
}

async function waitHealth(limitMs) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${APP_URL}/api/health`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// Probe a running ARTEX instance (its /api/health reports service=artex).
// Reusing it keeps the ORIGIN (host:port) stable — UI preferences live in
// origin-scoped cookies, so landing on another port silently resets them.
async function probeArtex(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const body = await res.json();
    if (body && body.service === 'artex') return body;
  } catch {
    /* not up, or not artex */
  }
  return null;
}

// Stop the portable cluster this shell supervises. Without this the next launch
// finds 5433 (and often the HTTP port) still held by an orphaned postmaster,
// which is what pushes the app onto another port and resets its preferences.
function stopPostgres() {
  const pgData = path.join(PG_ROOT, 'pgdata');
  const pgCtl = path.join(PG_ROOT, 'pgsql', 'bin', 'pg_ctl.exe');
  if (!fs.existsSync(pgData) || !fs.existsSync(pgCtl)) return;
  try {
    const r = spawnSync(pgCtl, ['-D', pgData, 'stop', '-m', 'fast', '-w', '-t', '20'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    logLine(`postgres stop rc=${r.status}`);
  } catch (err) {
    logLine(`postgres stop failed: ${err}`);
  }
}

// Output must go to a file descriptor, not a pipe (see the header comment).
function logFd(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return fs.openSync(file, 'a');
  } catch {
    return 'ignore';
  }
}

function loadEnvFile(file) {
  const out = {};
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 1) continue;
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    /* no env file */
  }
  return out;
}

function tailFile(file, lines = 22) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .slice(-lines)
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------ preflight
// Everything checked here is a failure mode that used to end in a black window.
function vcRuntimeCheck() {
  const names = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'];
  const bin = path.join(PG_ROOT, 'pgsql', 'bin');
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const missing = names.filter(
    (n) => !fs.existsSync(path.join(bin, n)) && !fs.existsSync(path.join(sys, n))
  );
  return {
    ok: missing.length === 0,
    missing,
    bundled: names.every((n) => fs.existsSync(path.join(bin, n))),
    system: names.every((n) => fs.existsSync(path.join(sys, n))),
  };
}

function dirWritable(dir) {
  const probe = path.join(dir, `.artex-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function preflight() {
  const items = [];
  const add = (level, title, detail) => items.push({ level, title, detail });

  if (/[^\x00-\x7F]/.test(EXE_DIR)) {
    add(
      'error',
      '安装路径含非 ASCII 字符',
      `PostgreSQL 的 initdb 无法在含中文/特殊字符的路径下初始化数据目录：${EXE_DIR}。请卸载后重装到纯英文路径（例如 D:\\ARTEX）。`
    );
  }
  if (!dirWritable(RESOURCES)) {
    add(
      'error',
      '安装目录不可写',
      `无法在 ${RESOURCES} 下写入 —— 数据库集群与日志都要写在这里。请改装到可写目录，或检查杀毒软件的受保护文件夹设置。`
    );
  }
  const vc = vcRuntimeCheck();
  if (!vc.ok) {
    add(
      'error',
      '缺少 Microsoft Visual C++ 运行库',
      `便携 PostgreSQL 需要 ${vc.missing.join(' / ')}（本机 System32 与安装包内都没有）。请安装 “Microsoft Visual C++ 2015-2022 Redistributable (x64)” 后重启电脑再打开 ARTEX。`
    );
  }
  for (const [label, p] of [
    ['pg_ctl.exe', path.join(PG_ROOT, 'pgsql', 'bin', 'pg_ctl.exe')],
    ['initdb.exe', path.join(PG_ROOT, 'pgsql', 'bin', 'initdb.exe')],
    ['artex.exe', path.join(APP_DIR, 'artex.exe')],
  ]) {
    if (!fs.existsSync(p)) add('error', `缺少 ${label}`, `${p} 不存在 —— 安装可能不完整，建议重新安装。`);
  }
  return items;
}

// ------------------------------------------------------------------- diagnose
const PGLOG = path.join(PG_ROOT, 'pglog');

function buildDiag(reason, extra = {}) {
  return {
    reason,
    when: new Date().toISOString(),
    appDir: APP_DIR,
    pgRoot: PG_ROOT,
    installDir: EXE_DIR,
    resources: RESOURCES,
    ports: { http: PORT, db: DB_PORT, proxy: PROXY_PORT },
    url: APP_URL,
    vc: vcRuntimeCheck(),
    writable: (() => {
      try {
        return dirWritable(RESOURCES);
      } catch {
        return false;
      }
    })(),
    ascii: !/[^\x00-\x7F]/.test(EXE_DIR),
    items: extra.items || preflight(),
    shellLog: SHELL_LOG,
    artexLog: ARTEX_LOG,
    pgLogs: {
      initdb: path.join(PGLOG, 'initdb.log'),
      pgctl: path.join(PGLOG, 'pg_ctl-start.log'),
      postgres: path.join(PGLOG, 'postgres.log'),
    },
    tails: {
      shell: tailFile(SHELL_LOG, 25),
      artex: tailFile(ARTEX_LOG, 25),
      initdb: tailFile(path.join(PGLOG, 'initdb.log'), 20),
      postgres: tailFile(path.join(PGLOG, 'postgres.log'), 20),
    },
  };
}

async function showDiagnose(reason, extra) {
  diagState = buildDiag(reason, extra);
  logLine(`showing the diagnose page (${reason})`);
  if (!mainWin || mainWin.isDestroyed()) return;
  try {
    await mainWin.loadFile(path.join(__dirname, 'diagnose.html'));
    await mainWin.webContents.executeJavaScript(
      `window.__ARTEX_DIAG__ = ${JSON.stringify(diagState)}; if (window.renderDiagnose) window.renderDiagnose();`,
      true
    );
    if (!mainWin.isVisible()) mainWin.show();
    mainWin.focus();
  } catch (err) {
    logLine(`diagnose page failed: ${err}`);
  }
}

// --------------------------------------------------------------- local stack
// Short-lived helpers only (initdb / createdb / psql). Safe to capture because
// no server child survives to hold the write end of the pipe.
function runCapture(exe, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout?.on('data', (b) => (out += b));
    child.stderr?.on('data', (b) => (out += b));
    child.once('error', (err) => resolve({ code: -1, out: String(err) }));
    child.once('exit', (code) => resolve({ code, out }));
  });
}

// Make the cluster config agree with the port we will actually use.
function ensurePgConfPort(pgData, port) {
  const conf = path.join(pgData, 'postgresql.conf');
  try {
    let txt = fs.existsSync(conf) ? fs.readFileSync(conf, 'utf8') : '';
    const marker = '# ARTEX (written by the desktop shell)';
    if (txt.includes(marker)) {
      txt = txt.replace(/(# ARTEX \(written by the desktop shell\)[\s\S]*?port = )\d+/, `$1${port}`);
    } else if (!new RegExp(`^port = ${port}$`, 'm').test(txt)) {
      txt += `\n${marker}\nport = ${port}\nlisten_addresses = '127.0.0.1'\n`;
    }
    fs.writeFileSync(conf, txt);
    return true;
  } catch (err) {
    logLine(`postgresql.conf port not updated: ${err}`);
    return false;
  }
}

// The backend reads the database port from config.json: keep them in sync.
function ensureConfigDbPort() {
  const cfgPath = path.join(APP_DIR, 'config.json');
  try {
    if (!fs.existsSync(cfgPath)) return true;
    const j = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!j.database || Number(j.database.port) === DB_PORT) return true;
    fs.copyFileSync(cfgPath, `${cfgPath}.bak`);
    j.database.port = DB_PORT;
    fs.writeFileSync(cfgPath, JSON.stringify(j, null, 2));
    logLine(`config.json database.port -> ${DB_PORT} (backup: config.json.bak)`);
    return true;
  } catch (err) {
    logLine(`config.json not updated: ${err}`);
    return false;
  }
}

// Fresh machine: initialise a local-only cluster with trust auth (nothing to
// guess, no password ships in the installer), make sure the database exists,
// then let ARTEX create its own schema. The admin password is intentionally
// empty so the very first screen is /setup, where the operator sets one.
async function provisionPostgres(bin) {
  const pgData = path.join(PG_ROOT, 'pgdata');
  const pgLog = path.join(PG_ROOT, 'pglog', 'postgres.log');
  fs.mkdirSync(path.dirname(pgLog), { recursive: true });

  if (!fs.existsSync(path.join(pgData, 'PG_VERSION'))) {
    logLine(`first run: initdb into ${pgData}`);
    const fd = logFd(path.join(PG_ROOT, 'pglog', 'initdb.log'));
    const child = spawn(
      path.join(bin, 'initdb.exe'),
      ['-D', pgData, '-U', DB_USER, '-E', 'UTF8', '--locale=C', '-A', 'trust'],
      { stdio: ['ignore', fd, fd], windowsHide: true }
    );
    const code = await new Promise((resolve) => child.once('exit', resolve));
    logLine(`initdb exit=${code}`);
    if (code !== 0) return false;
  }
  // Always align the cluster port with the port we picked (the file may have
  // been written by an earlier run on a different port).
  ensurePgConfPort(pgData, DB_PORT);
  ensureConfigDbPort();

  const pidFile = path.join(pgData, 'postmaster.pid');
  // Only ever clear a pid file when nothing answers on the port: a live server
  // keeps that file as its lock, and deleting it invites a second postmaster
  // on the same data directory.
  if (fs.existsSync(pidFile) && !(await portOpen(DB_PORT))) {
    logLine('removing stale postmaster.pid');
    try {
      fs.unlinkSync(pidFile);
    } catch {
      /* ignore */
    }
  } else if (fs.existsSync(pidFile)) {
    logLine('postmaster.pid present and the port answers - leaving it alone');
  }

  const fd = logFd(path.join(PG_ROOT, 'pglog', 'pg_ctl-start.log'));
  logLine(`starting postgres on ${DB_PORT}`);
  const child = spawn(
    path.join(bin, 'pg_ctl.exe'),
    ['-D', pgData, '-l', pgLog, '-o', `-p ${DB_PORT}`, '-w', '-t', '60', 'start'],
    { stdio: ['ignore', fd, fd], windowsHide: true }
  );
  await new Promise((resolve) => child.once('exit', resolve));
  if (!(await waitPort(DB_PORT, 40000))) {
    logLine('postgres did not open its port');
    return false;
  }

  const probe = await runCapture(
    path.join(bin, 'psql.exe'),
    ['-U', DB_USER, '-h', '127.0.0.1', '-p', String(DB_PORT), '-d', 'postgres', '-tAc', 'SELECT 1 FROM pg_database WHERE datname = \'artex\''],
    PG_ROOT
  );
  if (probe.out.trim() !== '1') {
    const made = await runCapture(path.join(bin, 'createdb.exe'), [
      '-U', DB_USER, '-h', '127.0.0.1', '-p', String(DB_PORT), 'artex',
    ]);
    logLine(`createdb exit=${made.code}`);
  }

  const cfgPath = path.join(APP_DIR, 'config.json');
  if (!fs.existsSync(cfgPath)) {
    fs.writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          database: {
            host: '127.0.0.1',
            port: DB_PORT,
            user: DB_USER,
            password: '',
            dbname: 'artex',
            sslmode: 'disable',
          },
        },
        null,
        2
      )
    );
    logLine('wrote config.json (local connection, empty password)');
  }
  return true;
}

// A port that answers is not proof that OUR cluster is behind it: ask it.
async function pgUsable(port) {
  const bin = path.join(PG_ROOT, 'pgsql', 'bin');
  if (!fs.existsSync(path.join(bin, 'psql.exe'))) return true; // cannot verify: trust the port
  const q = await runCapture(
    path.join(bin, 'psql.exe'),
    ['-U', DB_USER, '-h', '127.0.0.1', '-p', String(port), '-d', 'postgres', '-tAc', 'SELECT 1'],
    PG_ROOT
  );
  return q.out.trim() === '1';
}

async function ensurePostgres() {
  if (await portOpen(DB_PORT)) {
    if (await pgUsable(DB_PORT)) {
      logLine(`postgres already listening on ${DB_PORT} (verified)`);
      ensureConfigDbPort();
      return true;
    }
    logLine(`port ${DB_PORT} is open but is not our PostgreSQL`);
    return false;
  }
  const bin = path.join(PG_ROOT, 'pgsql', 'bin');
  if (!fs.existsSync(path.join(bin, 'pg_ctl.exe'))) {
    logLine(`pg_ctl missing: ${bin}`);
    return false;
  }
  return provisionPostgres(bin);
}

function startArtex(env) {
  const bin = path.join(APP_DIR, 'artex.exe');
  if (!fs.existsSync(bin)) {
    logLine(`artex.exe missing: ${bin}`);
    return false;
  }
  const fd = logFd(ARTEX_LOG);
  // Pass the chosen ports explicitly: the backend's own defaults are the fixed
  // 8787/8788 pair, which is exactly what falls over on a busy machine.
  artexChild = spawn(bin, ['-addr', `127.0.0.1:${PORT}`, '-proxy', `127.0.0.1:${PROXY_PORT}`], {
    cwd: APP_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  logLine(`artex started pid=${artexChild.pid} addr=127.0.0.1:${PORT} proxy=127.0.0.1:${PROXY_PORT}`);
  artexChild.once('exit', (code) => {
    artexChild = null;
    if (quitting) return;
    logLine(`artex exited code=${code}`);
    if (code === 0) {
      app.quit();
      return;
    }
    if (code === 75) {
      restartDelay = 1000;
      logLine('artex asked for a restart (update/rollback)');
    } else {
      const wait = restartDelay;
      restartDelay = Math.min(restartDelay * 2, 60000);
      logLine(`artex crashed, retrying in ${wait} ms`);
      setTimeout(() => {
        if (!quitting) startArtex(loadEnvFile(path.join(APP_DIR, 'artex-llm.env')));
      }, wait);
      return;
    }
    setTimeout(() => {
      if (!quitting) startArtex(loadEnvFile(path.join(APP_DIR, 'artex-llm.env')));
    }, 500);
  });
  return true;
}

// -------------------------------------------------------------------- window
function createWindow() {
  // Never ask for a window larger than the work area: on a 175%-scaled laptop
  // the logical screen can be narrower than the old 1500x940 request, and an
  // oversized window lays the page out at that larger viewport, which clips the
  // right-hand side of every page (diagnose page included).
  let availW = 1280;
  let availH = 800;
  try {
    const area = screen.getPrimaryDisplay().workAreaSize;
    if (area && area.width) {
      availW = area.width;
      availH = area.height;
    }
  } catch {
    /* keep the fallback */
  }
  mainWin = new BrowserWindow({
    width: Math.min(1500, Math.max(900, availW - 40)),
    height: Math.min(940, Math.max(600, availH - 40)),
    show: false,
    backgroundColor: '#111416',
    title: 'ARTEX',
    icon: fs.existsSync(ICON_ICO) ? ICON_ICO : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWin.removeMenu?.();
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.once('did-finish-load', () => {
    logLine('first paint - revealing the window');
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.show();
      mainWin.focus();
    }
  });
  mainWin.on('closed', () => {
    mainWin = null;
  });
}

async function boot() {
  createWindow();

  const env = loadEnvFile(path.join(APP_DIR, 'artex-llm.env'));
  logLine(`app dir=${APP_DIR} llm env vars=${Object.keys(env).length}`);

  // 1. preflight + ports (never let a busy port or a missing runtime end in a
  //    window that loads nothing)
  // 0. Reuse a running instance: same origin, so the user's preferences survive.
  const running = await probeArtex(`http://127.0.0.1:${PREF_PORT}`);
  if (running) {
    PORT = PREF_PORT;
    APP_URL = `http://127.0.0.1:${PORT}`;
    logLine(`reusing running ARTEX at ${APP_URL} (version ${running.version || '?'})`);
    if (mainWin && !mainWin.isDestroyed()) {
      try {
        await mainWin.webContents.loadURL(APP_URL);
      } catch (err) {
        logLine(`reuse load failed: ${err}`);
      }
    }
    return;
  }

  const items = preflight();
  for (const it of items) logLine(`preflight ${it.level}: ${it.title} - ${it.detail}`);

  PORT = await choosePort(PREF_PORT, 'http');
  APP_URL = `http://127.0.0.1:${PORT}`;
  PROXY_PORT = await choosePort(PREF_PROXY_PORT, 'proxy');
  // The database port is deliberately NOT pre-emptively moved: a port that
  // already answers is usually OUR postgres (this shell outlives app restarts).
  // ensurePostgres() verifies it and boot() relocates only when that fails.
  DB_PORT = PREF_DB_PORT;
  if (PORT !== PREF_PORT || PROXY_PORT !== PREF_PROXY_PORT) {
    logLine(`ports in use: http=${PORT} proxy=${PROXY_PORT}`);
  }

  if (PORT !== PREF_PORT) {
    logLine(
      `port ${PREF_PORT} is held by another service; UI preferences are per-origin and will not follow to port ${PORT}`,
    );
    try {
      new Notification({
        title: 'ARTEX 端口被占用',
        body: `${PREF_PORT} 已被其它程序占用，本次改用 ${PORT}。界面设置与登录状态按端口隔离，可能不会跟随。`,
      }).show();
    } catch {
      /* notifications unavailable */
    }
  }

  const blockers = items.filter((it) => it.level === 'error');
  if (blockers.length) {
    await showDiagnose('启动前置检查未通过', { items });
    return;
  }

  // 2. local stack: verify an already-running cluster, and relocate ONCE if the
  //    preferred database port is held by something that is not our postgres.
  let pgOk = await ensurePostgres();
  if (!pgOk) {
    const alt = await choosePort(PREF_DB_PORT + 1, 'database');
    if (alt !== DB_PORT) {
      DB_PORT = alt;
      logLine(`retrying PostgreSQL on port ${DB_PORT}`);
      pgOk = await ensurePostgres();
    }
  }
  logLine(`postgres ready=${pgOk} port=${DB_PORT}`);
  if (!pgOk) {
    await showDiagnose('PostgreSQL 未能启动', { items });
    return;
  }
  startArtex(env);

  // 3. health, then the app itself
  const health = await waitHealth(120000);
  if (!health) {
    logLine('health never came up - showing the diagnose page');
    await showDiagnose('后端服务未就绪（/api/health 无响应）', { items });
    return;
  }
  logLine(`health ok: ${JSON.stringify(health)}`);

  if (mainWin && !mainWin.isDestroyed()) {
    try {
      await mainWin.webContents.loadURL(APP_URL);
    } catch (err) {
      logLine(`load failed: ${err}`);
      await showDiagnose(`无法加载 ${APP_URL}`, { items });
    }
  }
}

// --------------------------------------------------------------------- app
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    boot().catch(async (err) => {
      logLine(`boot failed: ${err && err.stack ? err.stack : err}`);
      await showDiagnose(`启动流程异常：${err && err.message ? err.message : err}`);
    });
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
    if (artexChild) {
      logLine(`stopping artex pid=${artexChild.pid}`);
      try {
        artexChild.kill();
      } catch {
        /* ignore */
      }
    }
    // Leaving PostgreSQL behind is what breaks the NEXT launch (port held =>
    // origin changes => preferences reset). Stop it cleanly.
    stopPostgres();
  });
}

ipcMain.handle('shell:info', () => ({ appDir: APP_DIR, url: APP_URL, pgRoot: PG_ROOT }));
ipcMain.handle('shell:diagnose', () => diagState || buildDiag('no failure recorded yet'));
ipcMain.handle('shell:openPath', async (_event, target) => {
  const p = typeof target === 'string' && target ? target : APP_DIR;
  try {
    await shell.openPath(p);
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle('shell:retry', () => {
  app.relaunch();
  app.exit(0);
});
ipcMain.handle('shell:quit', () => {
  app.quit();
});
