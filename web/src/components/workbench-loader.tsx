"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Workbench loading screen shown INSIDE the window right after signing in.
 *
 * Layout follows the reference loading screen the user provided: outlined giant
 * watermark, a survey-triangle emblem, a TIPS block on the left rail, and a long
 * animated progress bar along the bottom edge with a NOW LOADING... caption.
 * The reference's 终末地 wordmark is retitled to ARTEX here (only the app icon and
 * this screen do that; the boot animation keeps the original lockup).
 *
 * Shown once per browser session (sessionStorage), i.e. exactly after logging in.
 */
const TIPS: Array<{ title: string; body: string }> = [
  { title: "任务编排", body: "一次「探索」会派生多个 work agent，并行收敛到同一目标。" },
  { title: "资产同步", body: "接上 ScopeSentry 后，资产与扫描结果会随任务自动回填。" },
  { title: "流量录制", body: "把 HTTP_PROXY 指向 127.0.0.1:8788 并信任 _ca，即可记录全部交互。" },
  { title: "技能授权", body: "SKILL 页可控制每个 Agent 能自动触发的技能集合。" },
  { title: "令牌用量", body: "仪表盘的 Token 消耗按任务与模型拆分，便于控制成本。" },
];

const SESSION_FLAG = "artex_show_workbench_loader";
const DURATION_MS = 2900;

export function WorkbenchLoader() {
  const [visible, setVisible] = useState(false);
  const [percent, setPercent] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // A stable-looking per-load identifier, in the spirit of the reference's UID.
  const uid = useMemo(() => {
    const base = Date.now() % 100000000;
    return String(base).padStart(8, "0");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Only right after a PASSWORD SIGN-IN: the login and first-run setup pages
    // drop this flag on success. A plain launch (or reload) does not set it, so
    // then only the root-layout boot animation plays.
    let show = false;
    try {
      show = sessionStorage.getItem(SESSION_FLAG) === "1";
      sessionStorage.removeItem(SESSION_FLAG);
    } catch {
      show = false;
    }
    if (!show) return;
    setVisible(true);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = reduced ? 600 : DURATION_MS;
    const started = performance.now();
    let raf = 0;
    let tipTimer = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / total);
      // Ease out, then a short "settling" plateau so the bar reads as real work.
      const eased = 1 - Math.pow(1 - t, 2.2);
      const jitter = t < 0.94 ? Math.sin(t * 34) * 0.9 : 0;
      const value = Math.max(0, Math.min(100, Math.round(eased * 100 + jitter)));
      setPercent(value);
      setElapsed(Math.round(now - started));
      if (t < 1) raf = requestAnimationFrame(tick);
      else finish();
    };

    const finish = () => {
      const root = rootRef.current;
      const done = () => setVisible(false);
      if (!root) {
        done();
        return;
      }
      try {
        const anim = root.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: reduced ? 120 : 420,
          easing: "cubic-bezier(.2,.7,.2,1)",
          fill: "both",
        });
        anim.finished.then(done).catch(done);
      } catch {
        done();
      }
    };

    raf = requestAnimationFrame(tick);
    tipTimer = window.setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 2400);
    const failsafe = window.setTimeout(() => setVisible(false), total + 4000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(tipTimer);
      window.clearTimeout(failsafe);
    };
  }, []);

  if (!visible) return null;
  const tip = TIPS[tipIndex];

  return (
    <div className="ef-load" ref={rootRef} role="status" aria-label="工作台加载中">
      <div className="ef-load__sky" aria-hidden="true" />
      <div className="ef-load__watermark" aria-hidden="true">
        <span>ARTEX</span>
        <span>AUTONOMOUS PENTEST CONSOLE</span>
      </div>
      <div className="ef-load__ridge ef-load__ridge--far" aria-hidden="true" />
      <div className="ef-load__ridge ef-load__ridge--near" aria-hidden="true" />
      <div className="ef-load__grain" aria-hidden="true" />

      {/* top-left identity lockup */}
      <div className="ef-load__brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="ARTEX" />
        <div>
          <b>ARTEX</b>
          <span>AUTONOMOUS PENTEST CONSOLE</span>
        </div>
      </div>

      {/* left rail with ticks, echoing the reference's vertical indicator */}
      <div className="ef-load__rail" aria-hidden="true">
        <i style={{ transform: `scaleY(${Math.max(0.02, percent / 100)})` }} />
        <b>{"0".repeat(Math.max(0, 3 - String(percent).length)) + percent}</b>
      </div>

      {/* centre emblem, retitled to ARTEX for this screen */}
      <svg className="ef-load__emblem" viewBox="0 0 640 720" role="img" aria-label="ARTEX">
        <defs>
          <clipPath id="efLoadTri">
            <polygon points="26,44 614,44 320,700" />
          </clipPath>
        </defs>
        <polygon className="ef-load__tri" points="26,44 614,44 320,700" />
        <g clipPath="url(#efLoadTri)">
          <path className="ef-load__contour" d="M120 92 C210 120 250 168 232 214 C214 258 138 268 96 244 C54 220 62 150 120 92 Z" />
          <path className="ef-load__contour" d="M150 112 C214 136 240 170 228 204 C216 238 158 244 126 226 C94 208 100 156 150 112 Z" />
          <path className="ef-load__contour" d="M300 76 C400 88 468 118 480 156 C492 196 420 214 350 208 C280 202 236 176 238 144 C240 118 262 74 300 76 Z" />
          <path className="ef-load__contour" d="M336 100 C404 110 452 132 460 156 C468 182 414 194 364 190 C314 186 288 168 290 148 C292 130 306 98 336 100 Z" />
          <path className="ef-load__contour" d="M470 240 C540 268 566 320 540 356 C512 394 424 396 380 368 C336 340 344 284 396 254 C424 238 448 232 470 240 Z" />
          <path className="ef-load__contour" d="M96 320 C150 336 178 372 166 404 C152 438 96 446 62 428 C28 410 34 358 96 320 Z" />
          <g className="ef-load__ribs">
            <path d="M300 470 L340 470" />
            <path d="M286 512 L354 512" />
            <path d="M272 554 L368 554" />
            <path d="M258 596 L382 596" />
            <path d="M244 638 L396 638" />
            <path d="M230 680 L410 680" />
          </g>
          <rect className="ef-load__band" x="0" y="246" width="640" height="118" />
          <text className="ef-load__word" x="320" y="312" textAnchor="middle" dominantBaseline="middle">
            ARTEX
          </text>
        </g>
        <g className="ef-load__rule">
          <path d="M28 404 L168 404" />
          <path d="M472 404 L612 404" />
        </g>
        <text className="ef-load__caption" x="320" y="404" textAnchor="middle" dominantBaseline="middle">
          AUTONOMOUS PENTEST CONSOLE
        </text>
      </svg>

      {/* rotating tips */}
      <div className="ef-load__tips">
        <span className="ef-load__tips-chip">TIPS</span>
        <h3>{tip.title}</h3>
        <p>{tip.body}</p>
      </div>

      {/* bottom bar: fills, then keeps a hatch/shimmer running */}
      <div className="ef-load__bar">
        <div className="ef-load__bar-track">
          <i className="ef-load__bar-fill" style={{ transform: `scaleX(${percent / 100})` }} />
          <i className="ef-load__bar-shimmer" />
        </div>
        <div className="ef-load__bar-caption">
          <span>NOW LOADING...</span>
          <b aria-hidden="true" />
        </div>
      </div>
      <div className="ef-load__dotted" aria-hidden="true" />

      <div className="ef-load__meta">
        <span className="ef-load__ms">{elapsed}ms</span>
        <span>UID: {uid}</span>
      </div>
    </div>
  );
}
