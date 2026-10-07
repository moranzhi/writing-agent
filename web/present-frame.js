/**
 * 正文组成 frontend 的隔离预览。
 * iframe 只用 sandbox="allow-scripts"，不加 allow-same-origin。
 * 模板通过 present.onData(cb) 收示例灌数，不能访问宿主页面。
 */

export const PRESENT_FRAME_SANDBOX = "allow-scripts";
export const PRESENT_BYTE_LIMIT = 60 * 1024;

const frames = new Map();
let seq = 0;

export function isFrontendBundle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return typeof value.html === "string" && /<\w+/.test(value.html);
}

export function presentSourceBytes(bundle) {
  const html = typeof bundle?.html === "string" ? bundle.html : "";
  const css = typeof bundle?.css === "string" ? bundle.css : "";
  const js = typeof bundle?.js === "string" ? bundle.js : "";
  return html.length + css.length + js.length;
}

export function previewPacket(sample) {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
    return { schema: "present.v1", blocks: {} };
  }
  if (sample.blocks && typeof sample.blocks === "object" && !Array.isArray(sample.blocks)) {
    return { schema: typeof sample.schema === "string" ? sample.schema : "present.v1", blocks: sample.blocks };
  }
  return { schema: "present.v1", blocks: sample };
}

export function queuePresentFrame(bundle, packet, slots) {
  const id = `pf${seq.toString(36)}${(seq += 1).toString(36)}`;
  frames.set(id, { bundle, packet, slots: Array.isArray(slots) ? slots : [] });
  return id;
}

export function presentFrameSlotHtml(id, minHeight) {
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  const h = Number(minHeight);
  const style = Number.isFinite(h) && h > 8 ? ` style="min-height:${Math.ceil(h)}px"` : "";
  return `<div class="present-frame-host" data-present-id="${safe}"${style}></div>`;
}

function neutralizeClosing(source, tag) {
  return String(source ?? "").replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function flattenFrameCss(css) {
  return String(css ?? "")
    .replace(/\b100(?:dvh|svh|lvh|vh)\b/g, "auto")
    .replace(/overflow(-[xy])?\s*:\s*(auto|scroll)\b/g, "overflow$1: visible");
}

export function buildPresentSrcdoc({ html = "", css = "", js = "", packet, slots, frameId }) {
  const safeId = String(frameId).replace(/[^a-zA-Z0-9_-]/g, "");
  const cssSafe = neutralizeClosing(flattenFrameCss(css), "style");
  const htmlSafe = String(html).replace(/<\/(body|html|head)\s*>/gi, "");
  const jsSafe = neutralizeClosing(js, "script");
  const packetJson = embedJson(packet ?? { schema: "present.v1", blocks: {} });
  const slotsJson = embedJson(Array.isArray(slots) ? slots : []);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; script-src 'unsafe-inline';">
<style>${cssSafe}</style>
<style>html,body{margin:0!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:hidden!important}[data-block] p,article p,#body p,#piece p{margin:0 0 .75em}[data-block] p:last-child,article p:last-child,#body p:last-child,#piece p:last-child{margin-bottom:0}[data-block] table.present-data-table{width:100%;border-collapse:collapse;font-size:inherit;margin:0 0 .75em}[data-block] table.present-data-table th,[data-block] table.present-data-table td{border:1px solid color-mix(in srgb,currentColor 22%,transparent);padding:.28em .45em;text-align:left;vertical-align:top}[data-block] table.present-data-table th{font-weight:600;opacity:.85}[data-block] .present-kv-nested{margin:.15em 0 .35em .6em;padding-left:.55em;border-left:2px solid color-mix(in srgb,currentColor 18%,transparent);font-size:.95em;white-space:pre-wrap}</style>
<script>
(function () {
  var FRAME_ID = ${JSON.stringify(safeId)};
  var PACKET = ${packetJson};
  var SLOTS = ${slotsJson};
  var failed = false;
  function post(type, extra) {
    var msg = { source: "present-frame", type: type, id: FRAME_ID };
    if (extra) {
      for (var k in extra) msg[k] = extra[k];
    }
    parent.postMessage(msg, "*");
  }
  function reportError(err) {
    failed = true;
    post("error", { message: String(err && err.message ? err.message : err) });
  }
  function markdown(raw) {
    var s = String(raw == null ? "" : raw)
      .replace(/\\r\\n/g, "\\n")
      .replace(/\\r/g, "\\n")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    s = s.replace(/\`([^\`]+)\`/g, "<code>$1</code>");
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
    return s.split(/\\n{2,}/).map(function (part) {
      return "<p>" + part.replace(/\\n/g, "<br>") + "</p>";
    }).join("");
  }
  function slotType(id) {
    for (var i = 0; i < SLOTS.length; i++) {
      if (SLOTS[i] && SLOTS[i].id === id && SLOTS[i].type) return SLOTS[i].type;
    }
    return "text";
  }
  function normalizeType(type) {
    if (type === "safe_markdown") return "markdown";
    return type || "text";
  }
  function isProgramOwned(type) {
    var t = normalizeType(type);
    return t === "markdown" || t === "text" || t === "list" || t === "kv" || t === "table" || t === "topology";
  }
  function isEmpty(value) {
    if (value == null) return true;
    if (typeof value === "string") return !value.trim();
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
  }
  function listItemText(item) {
    if (item == null) return "";
    if (typeof item === "string") {
      var s = item.trim();
      if (s.charAt(0) === "{" && s.indexOf('"text"') !== -1) {
        try {
          var parsed = JSON.parse(s);
          if (parsed && typeof parsed === "object") return listItemText(parsed);
        } catch (err) { /* keep raw */ }
      }
      return item;
    }
    if (typeof item === "object") {
      if (typeof item.text === "string") return item.text;
      if (typeof item.label === "string") return item.label;
      if (typeof item.title === "string") return item.title;
      if (typeof item.content === "string") return item.content;
      if (typeof item.name === "string" && typeof item.value === "string") {
        return item.name + "：" + item.value;
      }
    }
    return typeof item === "string" ? item : JSON.stringify(item);
  }
  function isBlockId(id) {
    if (!id || typeof id !== "string") return false;
    if (id.length > 128) return false;
    if (/["'<>\\\\]|[\\x00-\\x1f]/.test(id)) return false;
    return true;
  }
  function blockSelector(id) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return '[data-block="' + CSS.escape(id) + '"]';
    }
    return '[data-block="' + String(id).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"') + '"]';
  }
  function tryParseJson(value) {
    if (typeof value !== "string") return value;
    var t = value.trim();
    if (!t) return value;
    var start = t.charAt(0);
    var end = t.charAt(t.length - 1);
    if (!((start === "{" && end === "}") || (start === "[" && end === "]"))) return value;
    try { return JSON.parse(t); } catch (err) { return value; }
  }
  function cellText(cell) {
    if (cell == null) return "";
    if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
      return String(cell);
    }
    try { return JSON.stringify(cell); } catch (err) { return String(cell); }
  }
  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
  function writeDataTable(el, rows, columns) {
    if (!rows || !rows.length) return false;
    var cols = columns && columns.length ? columns.slice() : [];
    if (!cols.length) {
      var seen = {};
      rows.forEach(function (row) {
        if (!isPlainObject(row)) return;
        Object.keys(row).forEach(function (key) {
          if (!seen[key]) {
            seen[key] = true;
            cols.push(key);
          }
        });
      });
    }
    if (!cols.length) return false;
    var table = document.createElement("table");
    table.className = "present-data-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    cols.forEach(function (col) {
      var th = document.createElement("th");
      th.textContent = col;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      cols.forEach(function (col) {
        var td = document.createElement("td");
        td.textContent = isPlainObject(row) ? cellText(row[col]) : cellText(row);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    el.appendChild(table);
    return true;
  }
  function matrixMapToRows(map) {
    return Object.keys(map).map(function (name) {
      var stats = map[name];
      if (isPlainObject(stats)) {
        var row = { name: name };
        Object.keys(stats).forEach(function (key) { row[key] = stats[key]; });
        return row;
      }
      return { name: name, value: stats };
    });
  }
  function writeNestedKv(el, value, depth) {
    var data = tryParseJson(value);
    if (Array.isArray(data)) {
      if (data.length && data.every(isPlainObject)) {
        writeDataTable(el, data);
        return;
      }
      var pre = document.createElement("pre");
      pre.className = "present-kv-nested";
      pre.textContent = JSON.stringify(data, null, 2);
      el.appendChild(pre);
      return;
    }
    if (!isPlainObject(data)) {
      var plain = document.createElement("p");
      plain.textContent = cellText(data);
      el.appendChild(plain);
      return;
    }
    var keys = Object.keys(data);
    var objectEntries = [];
    var otherEntries = [];
    keys.forEach(function (key) {
      var cell = tryParseJson(data[key]);
      if (isPlainObject(cell)) objectEntries.push([key, cell]);
      else otherEntries.push([key, cell]);
    });
    if (
      objectEntries.length >= 1 &&
      objectEntries.length === keys.length &&
      objectEntries.every(function (pair) { return isPlainObject(pair[1]); })
    ) {
      writeDataTable(el, matrixMapToRows(data));
      return;
    }
    if (Array.isArray(data.rows)) {
      writeDataTable(el, data.rows, Array.isArray(data.columns) ? data.columns : null);
      return;
    }
    otherEntries.concat(objectEntries).forEach(function (pair) {
      var key = pair[0];
      var cell = pair[1];
      if (isPlainObject(cell) || Array.isArray(cell)) {
        var label = document.createElement("p");
        label.textContent = key + "：";
        el.appendChild(label);
        if (depth < 3) {
          var nest = document.createElement("div");
          nest.className = "present-kv-nested";
          writeNestedKv(nest, cell, depth + 1);
          el.appendChild(nest);
        } else {
          var deep = document.createElement("pre");
          deep.className = "present-kv-nested";
          deep.textContent = JSON.stringify(cell, null, 2);
          el.appendChild(deep);
        }
        return;
      }
      var row = document.createElement("p");
      row.textContent = key + "：" + cellText(cell);
      el.appendChild(row);
    });
  }
  function writeBlock(el, value, type) {
    var t = normalizeType(type);
    if (t === "list" && Array.isArray(value)) {
      var ul = document.createElement("ul");
      value.forEach(function (item) {
        var li = document.createElement("li");
        li.textContent = listItemText(item);
        ul.appendChild(li);
      });
      el.appendChild(ul);
      return;
    }
    if (t === "table") {
      var tableValue = tryParseJson(value);
      if (Array.isArray(tableValue)) {
        if (tableValue.length && tableValue.every(isPlainObject)) {
          writeDataTable(el, tableValue);
          return;
        }
      }
      if (isPlainObject(tableValue)) {
        if (Array.isArray(tableValue.rows)) {
          writeDataTable(
            el,
            tableValue.rows,
            Array.isArray(tableValue.columns) ? tableValue.columns : null
          );
          return;
        }
        var onlyKeys = Object.keys(tableValue);
        if (onlyKeys.length === 1) {
          var only = tryParseJson(tableValue[onlyKeys[0]]);
          if (Array.isArray(only) && only.length && only.every(isPlainObject)) {
            writeDataTable(el, only);
            return;
          }
          if (isPlainObject(only)) {
            var nestedKeys = Object.keys(only);
            if (nestedKeys.length && nestedKeys.every(function (k) { return isPlainObject(only[k]); })) {
              writeDataTable(el, matrixMapToRows(only));
              return;
            }
          }
        }
        writeNestedKv(el, tableValue, 0);
        return;
      }
    }
    if ((t === "kv" || t === "topology") && value && typeof value === "object") {
      writeNestedKv(el, value, 0);
      return;
    }
    if (t === "markdown" || t === "text" || typeof value === "string") {
      el.innerHTML = markdown(typeof value === "string" ? value : JSON.stringify(value));
      return;
    }
    el.textContent = typeof value === "string" ? value : JSON.stringify(value);
  }
  function alreadyVisible(value) {
    var sample = "";
    if (typeof value === "string") sample = value.trim().slice(0, 24);
    else if (Array.isArray(value) && typeof value[0] === "string") sample = value[0].trim().slice(0, 24);
    if (sample.length < 8) return false;
    return (document.body && document.body.innerText ? document.body.innerText : "").indexOf(sample) !== -1;
  }
  function fillSlots() {
    var blocks = PACKET && PACKET.blocks ? PACKET.blocks : {};
    Object.keys(blocks).forEach(function (id) {
      if (!isBlockId(id)) return;
      var value = blocks[id];
      var type = slotType(id);
      var el = document.querySelector(blockSelector(id)) || document.getElementById(id);
      if (el) {
        if (isEmpty(value)) return;
        var empty = !el.textContent.trim() && !el.children.length;
        if (isProgramOwned(type) || empty) {
          while (el.firstChild) el.removeChild(el.firstChild);
          writeBlock(el, value, type);
        }
        return;
      }
      if (isEmpty(value) || alreadyVisible(value)) return;
      var host = document.createElement("section");
      host.setAttribute("data-block", id);
      writeBlock(host, value, type);
      document.body.appendChild(host);
    });
  }
  var renderCb = null;
  function pathOf(el) {
    var parts = [];
    var node = el;
    while (node && node !== document.documentElement) {
      var parent = node.parentElement;
      if (!parent) break;
      parts.push(Array.prototype.indexOf.call(parent.children, node));
      node = parent;
    }
    return parts.reverse().join("/");
  }
  function nodeAt(path) {
    var parts = String(path || "").split("/");
    var node = document.documentElement;
    for (var i = 0; i < parts.length; i++) {
      if (!node || !node.children) return null;
      node = node.children[Number(parts[i])];
    }
    return node;
  }
  function captureScrolls() {
    var list = [];
    var nodes = document.querySelectorAll("*");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.scrollTop && !n.scrollLeft) continue;
      list.push({ el: n, path: pathOf(n), top: n.scrollTop, left: n.scrollLeft });
    }
    list.push({
      path: "window",
      top: window.scrollY || 0,
      left: window.scrollX || 0
    });
    return list;
  }
  function restoreScrolls(list) {
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (row.path === "window") {
        window.scrollTo(row.left || 0, row.top || 0);
        continue;
      }
      var el = row.el && row.el.isConnected ? row.el : nodeAt(row.path);
      if (!el) continue;
      el.scrollTop = row.top;
      el.scrollLeft = row.left;
    }
  }
  function applyPacket(next) {
    var snaps = captureScrolls();
    if (next && next.blocks) PACKET = next;
    if (renderCb) {
      try { renderCb(PACKET); }
      catch (err) { reportError(err); }
    }
    try { fillSlots(); }
    catch (err) { reportError(err); }
    restoreScrolls(snaps);
  }
  window.present = {
    onData: function (cb) {
      renderCb = cb;
      try { cb(PACKET); }
      catch (err) { reportError(err); }
    },
    markdown: markdown
  };
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== "present-host" || data.type !== "packet") return;
    applyPacket(data.packet);
  });
  window.addEventListener("error", function (e) {
    reportError(e.error || e.message || "脚本错误");
  });
  window.present.__seal = function () {
    try { fillSlots(); }
    catch (err) { reportError(err); }
    if (failed) return;
    post("ready");
    var sendHeight = function () {
      var h = Math.max(
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0
      );
      post("height", { height: h });
    };
    sendHeight();
    window.addEventListener("resize", sendHeight);
    if (window.ResizeObserver && document.documentElement) {
      new ResizeObserver(sendHeight).observe(document.documentElement);
    }
  };
})();
</script>
</head>
<body>
${htmlSafe}
<script>${jsSafe}</script>
<script>if (window.present && present.__seal) present.__seal();</script>
</body>
</html>`;
}

function blocksToPlain(packet) {
  const blocks = packet?.blocks;
  if (!blocks || typeof blocks !== "object") return "";
  return Object.entries(blocks)
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      return `${key}\n${text}`;
    })
    .join("\n\n");
}

function mountOne(host, id, payload) {
  const frame = document.createElement("iframe");
  frame.className = "present-preview-frame";
  frame.setAttribute("sandbox", PRESENT_FRAME_SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("scrolling", "no");
  frame.title = "版式预览";
  const hinted = Number.parseFloat(host.style.minHeight);
  if (Number.isFinite(hinted) && hinted > 8) {
    frame.style.height = `${Math.ceil(hinted)}px`;
  }
  const srcdoc = buildPresentSrcdoc({
    html: payload.bundle.html,
    css: payload.bundle.css,
    js: payload.bundle.js,
    packet: payload.packet,
    slots: payload.slots,
    frameId: id,
  });
  const section = host.closest(".present-preview");
  const status = section?.querySelector(".present-preview-status");
  const fallback = section?.querySelector(".present-preview-fallback");
  let settled = false;

  const fail = (message) => {
    frame.hidden = true;
    if (status) {
      status.hidden = false;
      status.textContent = message;
    }
    const plain = blocksToPlain(payload.packet);
    if (fallback && plain) {
      fallback.hidden = false;
      fallback.textContent = plain;
    }
  };

  const timer = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    fail("模板 3 秒内没有就绪，下面是示例内容。");
  }, 3000);

  const onMessage = (event) => {
    if (!frame.isConnected) {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      return;
    }
    if (event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.source !== "present-frame" || data.id !== id) return;
    if (data.type === "height" && !frame.hidden) {
      const height = Number(data.height);
      if (height > 0) {
        const next = Math.max(1, Math.ceil(height));
        const prev = Math.ceil(Number.parseFloat(frame.style.height) || 0);
        frame.style.height = `${next}px`;
        host.style.minHeight = "";
        if (Math.abs(next - prev) >= 2) {
          frame.dispatchEvent(new CustomEvent("present-frame-resize", { bubbles: true }));
        }
      }
    }
    if (data.type === "ready") {
      settled = true;
      window.clearTimeout(timer);
    }
    if (data.type === "error") {
      window.clearTimeout(timer);
      if (!settled) {
        settled = true;
        fail(data.message ? `模板没有跑起来：${data.message}` : "模板没有跑起来。");
      } else if (status) {
        status.hidden = false;
        status.textContent = data.message || "模板运行出错";
      }
    }
  };
  window.addEventListener("message", onMessage);
  host.replaceChildren(frame);
  frame.srcdoc = srcdoc;
}

export function updatePresentFramePacket(frame, packet) {
  const win = frame?.contentWindow;
  if (!win) return false;
  try {
    win.postMessage(
      { source: "present-host", type: "packet", packet: previewPacket(packet) },
      "*",
    );
    return true;
  } catch {
    return false;
  }
}

export function mountPresentFrames(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll(".present-frame-host[data-present-id]").forEach((host) => {
    if (host.dataset.mounted === "1") return;
    const id = host.dataset.presentId;
    const payload = frames.get(id);
    if (!payload) return;
    host.dataset.mounted = "1";
    frames.delete(id);
    mountOne(host, id, payload);
  });
}

export function watchPresentFrames() {
  if (typeof document === "undefined" || watchPresentFrames.started) return;
  watchPresentFrames.started = true;
  const run = () => mountPresentFrames(document);
  const start = () => {
    const obs = new MutationObserver(run);
    obs.observe(document.body, { childList: true, subtree: true });
    run();
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
