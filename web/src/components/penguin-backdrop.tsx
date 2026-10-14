"use client";

/**
 * 右下角企鹅（第 3 版 · 号主 2026-10-14 反馈"显示被裁切/错位"后的修法）
 *
 * 前两版为什么显示不对：
 *  - 第 1 版：浮动 `<img>` 层，被工作区的不透明表面（`[data-slot="sidebar-inset"]` 的 bg-background）盖住 —— 看不见。
 *  - 第 2 版：把企鹅做成该**滚动容器**的背景图 + `background-attachment: fixed`。
 *    固定背景的定位参照视口，但**绘制仍被元素盒子裁切**；而该容器比视口高得多，
 *    于是只露出图片的一个切片 —— 就是截图里那种"被切断/错位"。
 *
 * 本版：挂到**画布级**（`html`/`body` 的背景）。
 *  - html 元素的背景会被传播到整个画布、**始终相对视口定位**，因此**永远不会被任何元素裁切**；
 *  - 工作区容器改成透明，画布背景（主题底色 + 企鹅）从内容下方透上来；
 *  - 卡片/表格仍是实心，天然盖住它 —— 满足"在文字和工作框之下"。
 *
 * 其它要求：
 *  - 不随滚动移动：画布背景 + `background-attachment: fixed`（html 背景本来就是视口锚定）。
 *  - 图案完整：`background-size: auto 58vh`（只按高等比缩放，不裁切）。
 *  - 随窗口缩放：`vh` + `clamp()`。
 *  - 静态不可点：纯背景，无元素、无事件。
 *  - 只在登录后的工作台：本组件只挂在 `(main)/layout.tsx`。
 *  - 浓度：素材里烘焙好的 62% alpha（与号主满意那一版一致）。
 */
export function PenguinBackdrop() {
  return (
    <style>{`
      /* ---------- 号主 2026-10-14：去掉皮肤里的两层全屏叠层 ----------
         这两条**必须放在常驻组件里**。上一版我误放进 BootSequence，
         而开屏动画播完会卸载整个覆盖层（连同 <style>），规则随之消失 ——
         表现就是"动画一结束，扫描线与颗粒又回来了"。 */
      [data-theme-preset="endfield"] body::after { display: none !important; }
      [data-theme-preset="endfield"] body::before { display: none !important; }

      html,
      body {
        background-image: url("/penguin.png") !important;
        background-repeat: no-repeat !important;
        background-position: right clamp(6px, 1.6vw, 28px) bottom clamp(2px, 0.8vh, 14px) !important;
        background-size: auto 58vh !important;
        background-attachment: fixed !important;
        background-color: var(--background, #0B0D0F);
      }
      /* 让画布背景（含企鹅）从工作区下方透上来；卡片等实心元素仍会盖住它 */
      [data-slot="sidebar-inset"] {
        background-color: transparent !important;
      }
      @media (max-width: 900px) {
        html, body { background-size: auto 42vh !important; }
      }
    `}</style>
  );
}
