"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Industrial opening sequence that plays INSIDE the application window.
 *
 * Beats and timings are ported from rison114514/grad-research-workbench
 * (renderer/js/boot-sequence.js): logos slide in, a vertical yellow load column
 * runs with a counter, the status copy changes, then a yellow wipe reveals the
 * workbench. Colours, fonts and the emblem are this project's Endfield tokens;
 * the identity row is the project logo × the retitled survey-triangle lockup.
 *
 * Rendered by the root layout, so it is part of the pre-rendered HTML: it shows
 * on first paint and removes itself once the reveal finishes.
 */
const PHASES: Array<[number, string, string]> = [
  [12, "INITIALIZING", "初始化本地运行时"],
  [34, "LOADING", "启动本地数据库"],
  [58, "LOADING", "载入研究数据与视觉系统"],
  [80, "VERIFYING", "校验本地服务与工作模块"],
  [96, "VERIFYING", "服务已就绪，准备进入工作台"],
  [100, "READY", "工作台加载完成"],
];

function phaseFor(percent: number): [string, string] {
  let phase = PHASES[0][1];
  let copy = PHASES[0][2];
  for (const [at, p, c] of PHASES) {
    if (percent >= at) {
      phase = p;
      copy = c;
    }
  }
  return [phase, copy];
}

export function BootSequence() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const speed = reduced ? 0.3 : 1;
    const fill = root.querySelector<HTMLElement>(".ef-boot__fill");
    const value = root.querySelector<HTMLElement>(".ef-boot__value");
    const number = root.querySelector<HTMLElement>(".ef-boot__value b");
    const track = root.querySelector<HTMLElement>(".ef-boot__track");
    const status = root.querySelector<HTMLElement>(".ef-boot__status");
    const wipe = root.querySelector<HTMLElement>(".ef-boot__wipe");
    if (!fill || !value || !number || !track || !status || !wipe) return;

    document.body.classList.add("ef-booting");
    root.classList.add("ef-boot--in");

    const total = 2700 * speed;
    const started = performance.now();
    let raf = 0;
    let lastPhase = "";
    let lastCopy = "";

    const setStatus = (phase: string, copy: string) => {
      if (phase === lastPhase && copy === lastCopy) return;
      lastPhase = phase;
      lastCopy = copy;
      status.innerHTML = `<span>${phase}</span><b>${copy}</b>`;
    };

    const finish = async () => {
      setStatus("READY", "工作台加载完成");
      try {
        const wipeIn = wipe.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
          duration: 720 * speed,
          easing: "cubic-bezier(.72,0,.18,1)",
          fill: "both",
        });
        await wipeIn.finished;
        root.classList.add("ef-boot--reveal");
        root.style.background = "transparent";
        const wipeOut = wipe.animate(
          [
            { transform: "scaleX(1)", opacity: 1 },
            { transform: "scaleX(1)", opacity: 0 },
          ],
          { duration: 760 * speed, delay: 110 * speed, easing: "cubic-bezier(.2,.7,.2,1)", fill: "both" },
        );
        await wipeOut.finished;
      } catch {
        /* any animation failure still removes the overlay below */
      }
      document.body.classList.remove("ef-booting");
      setGone(true);
    };

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / total);
      const eased = 1 - Math.pow(1 - t, 3.25);
      const percent = Math.min(100, Math.round(eased * 100));

      number.textContent = String(percent).padStart(3, "0");
      fill.style.transform = `scaleY(${eased})`;

      const markerHeight = value.offsetHeight || 43;
      const maxY = Math.max(0, track.clientHeight - markerHeight);
      const markerY = Math.max(0, Math.min(maxY, track.clientHeight * eased - markerHeight / 2));
      value.style.transform = `translate3d(0,${markerY}px,0)`;

      const [phase, copy] = phaseFor(percent);
      setStatus(phase, copy);

      if (t < 1) raf = requestAnimationFrame(tick);
      else void finish();
    };

    raf = requestAnimationFrame(tick);

    // Failsafe: never let the overlay trap the window.
    const failsafe = window.setTimeout(() => {
      if (root.isConnected) {
        document.body.classList.remove("ef-booting");
        setGone(true);
      }
    }, 12000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(failsafe);
      document.body.classList.remove("ef-booting");
    };
  }, []);

  if (gone) return null;

  return (
    <div className="ef-boot" ref={rootRef} role="status" aria-label="ARTEX 正在加载">
      <div className="ef-boot__material" aria-hidden="true" />
      <div className="ef-boot__rings" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="ef-boot__index" aria-hidden="true">
        ARTEX / STARTUP PROCEDURE
        <br />
        LOCAL OPERATIONS
      </div>

      <div className="ef-boot__loader">
        <div className="ef-boot__track">
          <i className="ef-boot__fill" />
        </div>
        <div className="ef-boot__value">
          <b>000</b>
          <span>%</span>
        </div>
      </div>

      <div className="ef-boot__identity">
        <figure className="ef-boot__project">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="ARTEX" />
          <figcaption>ARTEX · 自主渗透测试控制台</figcaption>
        </figure>

        <div className="ef-boot__divider" aria-hidden="true">
          <i />
          <span>×</span>
          <i />
        </div>

        <div className="ef-boot__emblem-wrap">
          {/* Reference lockup retitled to ARTEX: inverted survey triangle with
              topographic contours, the wordmark band and the caption rule. */}
          <svg className="ef-emblem" viewBox="0 0 640 720" role="img" aria-label="ARTEX">
            <defs>
              <clipPath id="efBootTri">
                <polygon points="26,44 614,44 320,700" />
              </clipPath>
            </defs>
            <polygon className="ef-emblem__tri" points="26,44 614,44 320,700" />
            <g clipPath="url(#efBootTri)">
              <path className="ef-emblem__contour" d="M120 92 C210 120 250 168 232 214 C214 258 138 268 96 244 C54 220 62 150 120 92 Z" />
              <path className="ef-emblem__contour" d="M150 112 C214 136 240 170 228 204 C216 238 158 244 126 226 C94 208 100 156 150 112 Z" />
              <path className="ef-emblem__contour" d="M300 76 C400 88 468 118 480 156 C492 196 420 214 350 208 C280 202 236 176 238 144 C240 118 262 74 300 76 Z" />
              <path className="ef-emblem__contour" d="M336 100 C404 110 452 132 460 156 C468 182 414 194 364 190 C314 186 288 168 290 148 C292 130 306 98 336 100 Z" />
              <path className="ef-emblem__contour" d="M470 240 C540 268 566 320 540 356 C512 394 424 396 380 368 C336 340 344 284 396 254 C424 238 448 232 470 240 Z" />
              <path className="ef-emblem__contour" d="M96 320 C150 336 178 372 166 404 C152 438 96 446 62 428 C28 410 34 358 96 320 Z" />
              <g className="ef-emblem__ribs">
                <path d="M300 470 L340 470" />
                <path d="M286 512 L354 512" />
                <path d="M272 554 L368 554" />
                <path d="M258 596 L382 596" />
                <path d="M244 638 L396 638" />
                <path d="M230 680 L410 680" />
              </g>
              <rect className="ef-emblem__band" x="0" y="246" width="640" height="118" />
              {/* The identity emblem keeps the original Endfield lockup, as asked:
                  the survey triangle, its contours and the 终末地 wordmark. Only the
                  app ICON uses the ARTEX retitle. */}
              <text className="ef-emblem__word" x="320" y="312" textAnchor="middle" dominantBaseline="middle">
                终末地
              </text>
            </g>
            <g className="ef-emblem__rule">
              <path d="M28 404 L168 404" />
              <path d="M472 404 L612 404" />
            </g>
            <text className="ef-emblem__caption" x="320" y="404" textAnchor="middle" dominantBaseline="middle">
              ENDFIELD INDUSTRIES
            </text>
          </svg>
        </div>
      </div>

      <div className="ef-boot__status">
        <span>INITIALIZING</span>
        <b>初始化本地运行时</b>
      </div>

      <div className="ef-boot__wipe" aria-hidden="true" />
    </div>
  );
}
