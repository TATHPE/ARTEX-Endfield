'use strict';

/* ARTEX boot driver.
 *
 * Same beats as rison114514/grad-research-workbench's boot-sequence.js:
 *   logos slide in -> vertical yellow fill grows while a counter runs and the
 *   status copy changes -> READY -> yellow wipe in -> reveal.
 *
 * Difference: the progress here is REAL. The Electron main process reports
 * PostgreSQL start-up, artex start-up and the /api/health check over IPC, and
 * the bar eases toward whatever it last reported. If the page is opened without
 * the shell (plain browser) a simulated sequence runs instead, so the animation
 * can be previewed and screenshot on its own.
 */
const BootSequence = {
  state: {
    target: 0,
    shown: 0,
    phase: 'INITIALIZING',
    copy: '初始化本地运行时',
    finished: false,
  },
  simulated: false,

  async init() {
    this.root = document.getElementById('bootSequence');
    this.fill = document.getElementById('bootLoaderFill');
    this.value = document.getElementById('bootLoaderValue');
    this.number = this.value && this.value.querySelector('b');
    this.loader = this.root && this.root.querySelector('.boot-loader-track');
    this.status = document.getElementById('bootStatusCopy');
    this.wipeLayer = document.getElementById('bootYellowWipe');
    this.projectLogo = this.root && this.root.querySelector('.boot-project-logo');
    this.endfieldLogo = this.root && this.root.querySelector('.boot-endfield-logo');
    this.divider = this.root && this.root.querySelector('.boot-logo-divider');
    this.contours = this.root && this.root.querySelector('.boot-contours');
    if (!this.root || !this.fill || !this.value || !this.number || !this.loader || !this.wipeLayer) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.body.classList.add('booting');

    // Identity entrance is CSS keyframes (see splash.css) - one class kicked off
    // on the next frame so the transition runs on first paint.
    const staticPreview = new URLSearchParams(location.search).has('static');
    if (staticPreview) {
      this.root.classList.add('boot-in', 'static');
    } else {
      requestAnimationFrame(() => this.root.classList.add('boot-in'));
    }

    if (window.shell && typeof window.shell.onBootProgress === 'function') {
      window.shell.onBootProgress((data) => this.report(data));
    } else {
      this.simulated = true;
      this.simulate();
    }

    this.tick();
  },

  report(data) {
    if (!data) return;
    if (typeof data.percent === 'number') this.state.target = Math.max(this.state.target, Math.min(100, data.percent));
    if (data.phase) this.state.phase = data.phase;
    if (data.copy) this.state.copy = data.copy;
  },

  /* preview mode (no Electron shell): mirrors the reference project's own
     timeline so the animation can be reviewed on its own. */
  async simulate() {
    const steps = [
      [8, 'INITIALIZING', '初始化本地运行时', 340],
      [22, 'LOADING', '启动本地数据库', 620],
      [52, 'LOADING', '载入研究数据与视觉系统', 760],
      [74, 'VERIFYING', '校验本地服务与工作模块', 620],
      [96, 'VERIFYING', '服务已就绪，准备进入工作台', 420],
      [100, 'READY', '工作台加载完成', 260],
    ];
    for (const [percent, phase, copy, wait] of steps) {
      this.report({ percent, phase, copy });
      await new Promise((r) => setTimeout(r, wait));
    }
  },

  tick() {
    const s = this.state;
    s.shown += (s.target - s.shown) * 0.12;
    if (Math.abs(s.target - s.shown) < 0.4) s.shown = s.target;

    const eased = Math.min(1, s.shown / 100);
    const percent = Math.min(100, Math.round(eased * 100));
    this.number.textContent = String(percent).padStart(3, '0');
    this.fill.style.transform = `scaleY(${eased})`;

    const markerHeight = this.value.offsetHeight || 43;
    const maxY = Math.max(0, this.loader.clientHeight - markerHeight);
    const markerY = Math.max(0, Math.min(maxY, this.loader.clientHeight * eased - markerHeight / 2));
    this.value.style.transform = `translate3d(0,${markerY}px,0)`;

    if (this.status) this.status.innerHTML = `<span>${s.phase}</span><b>${s.copy}</b>`;

    requestAnimationFrame(() => this.tick());
  },

  pause(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  /* Yellow wipe in -> reveal -> wipe out. Called by the shell once the service
     is up (or by the page itself in preview mode). */
  async wipe() {
    if (this.state.finished || !this.wipeLayer) return;
    this.state.finished = true;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const speed = reduced ? 0.3 : 1;
    try {
      const wipeIn = this.wipeLayer.animate(
        [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
        { duration: 720 * speed, easing: 'cubic-bezier(.72,0,.18,1)', fill: 'both' }
      );
      await wipeIn.finished;
      this.root.classList.add('reveal-ready');
      this.root.style.background = 'transparent';
      const wipeOut = this.wipeLayer.animate(
        [
          { transform: 'scaleX(1)', opacity: 1 },
          { transform: 'scaleX(1)', opacity: 0 },
        ],
        { duration: 760 * speed, delay: 110 * speed, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' }
      );
      await wipeOut.finished;
      this.root.style.display = 'none';
    } catch (error) {
      this.root.style.display = 'none';
    }
  },
};

window.BootSequence = BootSequence;
document.addEventListener('DOMContentLoaded', () => BootSequence.init());

// Safety net, as in the reference: never let the overlay trap the window.
setTimeout(() => {
  const root = document.getElementById('bootSequence');
  if (root && !BootSequence.state.finished) root.style.display = 'none';
}, 180000);
