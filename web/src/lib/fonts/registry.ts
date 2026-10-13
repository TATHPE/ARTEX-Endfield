// TEMPORARY: offline build fallback — uses local Geist fonts instead of Google Fonts.
// Restore registry.ts.bak after build.
import localFont from "next/font/local";
import { GeistPixelSquare } from "geist/font/pixel";

const geist = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-geist" });
const inter = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-inter" });
const notoSans = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-noto-sans" });
const roboto = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-roboto" });
const outfit = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-outfit" });
const dmSans = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-dm-sans" });
const nunitoSans = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-nunito-sans" });
const figtree = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-figtree" });
const raleway = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-raleway" });
const publicSans = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-public-sans" });
const notoSerif = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-noto-serif" });
const robotoSlab = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-roboto-slab" });
const merriweather = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-merriweather" });
const lora = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-lora" });
const playfairDisplay = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-playfair-display" });
const geistMono = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2", variable: "--font-geist-mono" });
const jetBrainsMono = localFont({ src: "../../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2", variable: "--font-jetbrains-mono" });

// Endfield theme fonts, self-hosted (downloaded once from Google Fonts, then
// committed as woff2 so the build never needs the network). Only these two
// stacks exist in the reference atlas: a condensed display face and a mono face.
const endfieldCondensed = localFont({
  src: [
    { path: "./endfield/BarlowCondensed-400.woff2", weight: "400", style: "normal" },
    { path: "./endfield/BarlowCondensed-500.woff2", weight: "500", style: "normal" },
    { path: "./endfield/BarlowCondensed-600.woff2", weight: "600", style: "normal" },
    { path: "./endfield/BarlowCondensed-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-barlow-condensed",
  display: "swap",
  fallback: ["Arial Narrow", "Impact", "sans-serif"],
});
const endfieldMono = localFont({
  src: [
    { path: "./endfield/DMMono-300.woff2", weight: "300", style: "normal" },
    { path: "./endfield/DMMono-400.woff2", weight: "400", style: "normal" },
    { path: "./endfield/DMMono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-dm-mono",
  display: "swap",
  fallback: ["Consolas", "monospace"],
});

export const fontRegistry = {
  geist: { label: "Geist", font: geist },
  inter: { label: "Inter", font: inter },
  notoSans: { label: "Noto Sans", font: notoSans },
  nunitoSans: { label: "Nunito Sans", font: nunitoSans },
  figtree: { label: "Figtree", font: figtree },
  roboto: { label: "Roboto", font: roboto },
  raleway: { label: "Raleway", font: raleway },
  dmSans: { label: "DM Sans", font: dmSans },
  publicSans: { label: "Public Sans", font: publicSans },
  outfit: { label: "Outfit", font: outfit },
  geistMono: { label: "Geist Mono", font: geistMono },
  geistPixelSquare: { label: "Geist Pixel Square", font: GeistPixelSquare },
  jetBrainsMono: { label: "JetBrains Mono", font: jetBrainsMono },
  notoSerif: { label: "Noto Serif", font: notoSerif },
  robotoSlab: { label: "Roboto Slab", font: robotoSlab },
  merriweather: { label: "Merriweather", font: merriweather },
  lora: { label: "Lora", font: lora },
  playfairDisplay: { label: "Playfair Display", font: playfairDisplay },
  endfield: { label: "Endfield Condensed", font: endfieldCondensed },
  endfieldMono: { label: "Endfield Mono", font: endfieldMono },
} as const;

export type FontKey = keyof typeof fontRegistry;

export const fontVars = (Object.values(fontRegistry) as Array<(typeof fontRegistry)[FontKey]>)
  .map((f) => f.font.variable)
  .join(" ");

export const fontOptions = (Object.entries(fontRegistry) as [FontKey, { label: string; font: { variable: string } }][]).map(
  ([key, f]) => ({
    key,
    label: f.label,
    variable: f.font.variable,
  }),
);
