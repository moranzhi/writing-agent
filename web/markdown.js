/** Optional Markdown display — escaped first, then a small safe subset.
 *  Feature list (prompt injection): skills/.../markdown-safe-subset/catalog.yaml
 */

const STORAGE_KEY = "wa-markdown-render";

export function getStoredMarkdownRender() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isMarkdownRenderEnabled() {
  return document.documentElement.getAttribute("data-markdown-render") === "1";
}

export function applyMarkdownRender(enabled) {
  const on = Boolean(enabled);
  document.documentElement.setAttribute("data-markdown-render", on ? "1" : "0");
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  return on;
}

export function initMarkdownRender() {
  return applyMarkdownRender(getStoredMarkdownRender());
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isTableSeparator(line) {
  const t = String(line ?? "").trim();
  if (!t.includes("-")) return false;
  // GFM: | --- | :---: | ---: |
  return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(t);
}

function splitTableRow(line) {
  let s = String(line ?? "").trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** Safe subset: fences, details, tables, headings, emphasis, links, lists, quotes, hr. */
export function renderMarkdownToHtml(raw) {
  const text = String(raw ?? "");
  if (!text) return "";

  const fences = [];
  let src = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = fences.length;
    const langClass = lang ? ` class="language-${esc(lang)}"` : "";
    fences.push(
      `<pre class="md-pre"><code${langClass}>${esc(code.replace(/\n$/, ""))}</code></pre>`,
    );
    return `\u0000FENCE${i}\u0000`;
  });

  const lines = src.split(/\n/);
  const out = [];
  let i = 0;
  let para = [];
  let listType = null; // "ul" | "ol"
  let listItems = [];

  const flushPara = () => {
    if (!para.length) return;
    const body = para.map(inlineMarkdown).join("<br>");
    out.push(`<p class="md-p">${body}</p>`);
    para = [];
  };

  const flushList = () => {
    if (!listType || !listItems.length) {
      listType = null;
      listItems = [];
      return;
    }
    const tag = listType;
    out.push(
      `<${tag} class="md-${tag}">${listItems
        .map((item) => `<li>${inlineMarkdown(item)}</li>`)
        .join("")}</${tag}>`,
    );
    listType = null;
    listItems = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = line.match(/^\u0000FENCE(\d+)\u0000$/);
    if (fenceMatch) {
      flushPara();
      flushList();
      out.push(fences[Number(fenceMatch[1])] ?? "");
      i += 1;
      continue;
    }

    const detailsStart = line.match(/^:::details(?:\s+(open))?\s+(.+?)\s*$/);
    if (detailsStart) {
      flushPara();
      flushList();
      const openAttr = detailsStart[1] ? " open" : "";
      const summary = detailsStart[2];
      const bodyLines = [];
      i += 1;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) {
        bodyLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const inner = renderMarkdownToHtml(bodyLines.join("\n"));
      out.push(
        `<details class="md-details"${openAttr}><summary class="md-summary">${inlineMarkdown(
          summary,
        )}</summary><div class="md-details-body">${inner || ""}</div></details>`,
      );
      continue;
    }

    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      flushPara();
      flushList();
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        if (isTableSeparator(lines[i])) {
          i += 1;
          continue;
        }
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const thead = `<thead><tr>${headers
        .map((h) => `<th>${inlineMarkdown(h)}</th>`)
        .join("")}</tr></thead>`;
      const tbody = rows.length
        ? `<tbody>${rows
            .map(
              (cells) =>
                `<tr>${headers
                  .map((_, idx) => `<td>${inlineMarkdown(cells[idx] ?? "")}</td>`)
                  .join("")}</tr>`,
            )
            .join("")}</tbody>`
        : "";
      out.push(
        `<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`,
      );
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push('<hr class="md-hr">');
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      out.push(`<h${level} class="md-h">${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushPara();
      flushList();
      const quoteLines = [];
      while (i < lines.length) {
        const m = lines[i].match(/^>\s?(.*)$/);
        if (!m) break;
        quoteLines.push(m[1]);
        i += 1;
      }
      out.push(
        `<blockquote class="md-quote">${quoteLines
          .map((q) => `<p class="md-p">${inlineMarkdown(q)}</p>`)
          .join("")}</blockquote>`,
      );
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(ul[1]);
      i += 1;
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ol) {
      flushPara();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ol[1]);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushList();
      i += 1;
      continue;
    }

    flushList();
    para.push(line);
    i += 1;
  }

  flushPara();
  flushList();
  return out.join("") || esc(text).replace(/\n/g, "<br>");
}

function inlineMarkdown(line) {
  let s = esc(line);

  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    const i = codes.length;
    codes.push(`<code class="md-code">${code}</code>`);
    return `\u0000CODE${i}\u0000`;
  });

  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label, url) =>
      `<a class="md-a" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  );

  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codes[Number(i)] ?? "");
  return s;
}

/** Plain body: markdown when enabled, else escaped newlines. */
export function formatBodyHtml(text) {
  if (isMarkdownRenderEnabled()) return renderMarkdownToHtml(text);
  return esc(text).replace(/\n/g, "<br>");
}
