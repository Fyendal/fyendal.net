import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SeoPrerenderedLanding } from "./src/lobby/GuestLanding.tsx";
import { LegalPage } from "./src/legal/LegalPage.tsx";

const prerenderedLanding = renderToStaticMarkup(createElement(SeoPrerenderedLanding));

const LEGAL_ROUTES = [
  {
    fileName: "terms/index.html",
    path: "/terms/",
    title: "Terms of Service | Fyendal",
    description: "Read the terms for using Fyendal, the free community platform for playing Flesh and Blood online.",
    markup: renderToStaticMarkup(createElement(LegalPage, { kind: "terms" })),
  },
  {
    fileName: "privacy/index.html",
    path: "/privacy/",
    title: "Privacy Policy | Fyendal",
    description: "Learn what Fyendal stores, how game and account data are handled, and how to export or delete your account.",
    markup: renderToStaticMarkup(createElement(LegalPage, { kind: "privacy" })),
  },
] as const;

function replaceMetaContent(html: string, key: "name" | "property", name: string, content: string): string {
  const pattern = new RegExp(`<meta\\s+${key}="${name}"\\s+content="[^"]*"\\s*/?>`);
  return html.replace(pattern, `<meta ${key}="${name}" content="${content}" />`);
}

function replaceRootMarkup(html: string, markup: string): string {
  const rootStart = html.indexOf('<div id="root">');
  const bodyEnd = html.lastIndexOf("</body>");
  const rootEnd = html.lastIndexOf("</div>", bodyEnd);
  if (rootStart < 0 || rootEnd < rootStart) throw new Error("built client HTML is missing #root");
  return `${html.slice(0, rootStart)}<div id="root">${markup}</div>${html.slice(rootEnd + 6)}`;
}

function legalRouteHtml(homeHtml: string, route: (typeof LEGAL_ROUTES)[number]): string {
  let html = homeHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${route.title}</title>`)
    .replace(
      /<link rel="canonical" href="[^"]*"\s*\/?>/,
      `<link rel="canonical" href="https://fyendal.net${route.path}" />`,
    )
    .replace(
      /\s*<!-- fyendal-structured-data:start -->[\s\S]*?<!-- fyendal-structured-data:end -->/,
      "",
    );
  html = replaceMetaContent(html, "name", "description", route.description);
  html = replaceMetaContent(html, "property", "og:title", route.title);
  html = replaceMetaContent(html, "property", "og:description", route.description);
  html = replaceMetaContent(html, "property", "og:url", `https://fyendal.net${route.path}`);
  html = replaceMetaContent(html, "name", "twitter:title", route.title);
  html = replaceMetaContent(html, "name", "twitter:description", route.description);
  return replaceRootMarkup(html, route.markup);
}

function seoPrerender() {
  return {
    name: "fyendal-seo-prerender",
    enforce: "post" as const,
    transformIndexHtml(html: string) {
      return html.replace(
        '<div id="root"></div>',
        `<div id="root">${prerenderedLanding}</div>`,
      );
    },
    generateBundle(_options: unknown, bundle: Record<string, { type: string; source?: string | Uint8Array }>) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset" || typeof index.source !== "string") {
        throw new Error("client build did not produce index.html");
      }
      for (const route of LEGAL_ROUTES) {
        this.emitFile({
          type: "asset",
          fileName: route.fileName,
          source: legalRouteHtml(index.source, route),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), seoPrerender()],
  build: {
    // The card catalog is intentionally isolated and highly compressible
    // static game data (~2.7 MB raw, ~330 KB gzip), not application code.
    chunkSizeWarningLimit: 3_000,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
