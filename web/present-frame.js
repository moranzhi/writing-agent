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

export function queuePresentFrame(bundle, packet) {
  const id = `pf${seq.toString(36)}${(seq += 1).toString(36)}`;
  frames.set(id, { bundle, packet });
  return id;
}

export function presentFrameSlotHtml(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  return `<div class="present-frame-host" data-present-id="${safe}"></div>`;
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

export function buildPresentSrcdoc({ html = "", css = "", js = "", packet, frameId }) {
  const safeId = String(frameId).replace(/[^a-zA-Z0-9_-]/g, "");
  const cssSafe = neutralizeClosing(css, "style");
  const htmlSafe = String(html).replace(/<\/(body|html|head)\s*>/gi, "");
  const jsSafe = neutralizeClosing(js, "script");
  const packetJson = embedJson(packet ?? { schema: "present.v1", blocks: {} });
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; script-src 'unsafe-inline';">
<style>html,body{margin:0}</style>
<style>${cssSafe}</style>
<script>
(function () {
  var FRAME_ID = ${JSON.stringify(safeId)};
  var PACKET = ${packetJson};
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
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    s = s.replace(/\`([^\`]+)\`/g, "<code>$1</code>");
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
    return s.split(/\\n{2,}/).map(function (part) {
      return "<p>" + part.replace(/\\n/g, "<br>") + "</p>";
    }).join("");
  }
  window.present = {
    onData: function (cb) {
      try { cb(PACKET); }
      catch (err) { reportError(err); }
    },
    markdown: markdown
  };
  window.addEventListener("error", function (e) {
    reportError(e.error || e.message || "脚本错误");
  });
  window.present.__seal = function () {
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
  frame.title = "版式预览";
  const srcdoc = buildPresentSrcdoc({
    html: payload.bundle.html,
    css: payload.bundle.css,
    js: payload.bundle.js,
    packet: payload.packet,
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
        frame.style.height = `${Math.min(960, Math.max(180, Math.ceil(height)))}px`;
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
