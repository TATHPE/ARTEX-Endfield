"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 右下角企鹅（第 5 版 · 2026-10-14 定稿：修掉"随页面内容高度变化而变化"的病根）
 *
 * 前几版的教训（写在这里，避免以后又走回头路）：
 *  - v1/v2：布局内的 `<img>` 浮层 → 被工作区不透明表面盖住（看不见）。
 *  - v3：当成**滚动容器**的背景图 + `background-attachment: fixed` → 定位按视口、绘制被容器盒子裁切 → 只露一条。
 *  - v4：改到 `html/body` **画布背景** + `fixed` → 页面**不滚动**时正常（号主 18:21 那张截图就是这时），
 *        但页面一旦**可滚动**（如工作空间 4 行），同一份 CSS 会退回"相对元素盒子"锚定 →
 *        图片被拉到页面底部，只剩上半截可见（号主 19:08 那张）。**同一份代码，两种表现**，这就是病根。
 *
 * 本版：**真实元素 + `position: fixed`**（视口锚定）——与页面高度、是否滚动、父级 z-index/transform 全无关。
 *  - 挂到 `document.body`（portal），脱离应用内部所有层叠上下文。
 *  - `z-index: 0` + 布局里的 `SidebarProvider` 加 `relative z-10` → **在内容之下**；
 *    工作区容器 `[data-slot="sidebar-inset"]` 背景设透明，企鹅才能从内容下方透出来；
 *    卡片/表格仍是实心，天然盖住它（号主已确认接受）。
 *  - 右下角、`height: 58vh`、`width: auto` + `object-fit: contain` → **完整不裁切**、
 *    随窗口**等比缩放**（与号主 18:21 那张观感一致）。
 *  - `pointer-events: none` → 静态不可点；`position: fixed` → **不随滚动移动**。
 *  - 只挂在 `(main)/layout.tsx` → 登录页/开屏/加载页都没有它。
 *  - 同时常驻承担"移除皮肤两层全屏叠层（扫描线 body::after、颗粒 body::before）"的规则
 *    —— 这些规则必须放在**常驻**组件里（放进开屏动画组件会随动画卸载而失效，踩过）。
 *  - 素材透明度已烘焙在 PNG 里（62% alpha）。
 */
export function PenguinBackdrop() {
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => setMounted(true), []);
  // The watermark is a shipped look, not a requirement: ui.hide_penguin in
  // config.json turns the penguin off while the overlay rules below keep
  // applying (they clear the scanline/grain layers and the inset background).
  useEffect(() => {
    let alive = true;
    fetch("/api/ui-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j && j.hide_penguin) setHidden(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // The settings switch flips this without a reload: the card dispatches the new
  // value after a successful save.
  useEffect(() => {
    const onConfig = (event: Event) => {
      const detail = (event as CustomEvent<{ hide_penguin?: boolean }>).detail;
      if (detail && typeof detail.hide_penguin === "boolean") setHidden(detail.hide_penguin);
    };
    window.addEventListener("artex:ui-config", onConfig);
    return () => window.removeEventListener("artex:ui-config", onConfig);
  }, []);

  return (
    <>
      {mounted && !hidden
        ? createPortal(
            <div className="ef-pet" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/penguin.png" alt="" draggable={false} />
            </div>,
            document.body,
          )
        : null}
      <style>{`
        /* ---- 皮肤：移除两层全屏叠层（常驻生效） ---- */
        [data-theme-preset="endfield"] body::after { display: none !important; }   /* 全屏扫描线 */
        [data-theme-preset="endfield"] body::before { display: none !important; }  /* 颗粒质感 */

        /* ---- 让企鹅能从工作区下方透出来（卡片仍盖住它） ---- */
        [data-slot="sidebar-inset"] { background-color: transparent !important; }

        /* ---- 企鹅本体：视口锚定的固定元素，永不裁切、不随滚动 ---- */
        .ef-pet {
          position: fixed;
          right: clamp(8px, 1.8vw, 30px);
          bottom: clamp(4px, 1vh, 16px);
          z-index: 0;
          height: 58vh;
          pointer-events: none;
          user-select: none;
        }
        .ef-pet img {
          display: block;
          height: 100%;
          width: auto;
          max-width: 46vw;
          object-fit: contain;
        }
        @media (max-width: 900px) {
          .ef-pet { height: 44vh; }
        }
      `}</style>
    </>
  );
}
