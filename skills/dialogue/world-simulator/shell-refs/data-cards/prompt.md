# 数据常驻

## intro

```intro
数据一直铺在面上，不折叠，也不替换正文。正文仍是数百字的主文，占较宽的一栏。另一路内容占较窄的一栏。选项始终直接可见。
```

## layout

```layout
id: data-cards
主区: 数据常驻
附区: 正文（数百字）、窄栏
可加窄带: 抬头、文字选项
摆放:
  抬头: 最上的一行
  数据: 一直展开，紧挨抬头。当前值都短则并排；任一条较长则整组改为上下排列
  正文: 数据之下较宽的一栏，不因数据常驻而缩成一句
  窄栏: 较窄的一栏。栏顶标题按本局这块内容填写。窄屏改为正文在上、窄栏在下
  文字选项: 最下，始终直接可见
本局没有窄栏时删掉窄栏，正文占回整宽。两三条短内容用阅读壳的抬头一行，不用本壳。未启用的区不留空位。
```

## note

```note
不替换：数据区在抬头下一直展开。正文在其下较宽的一栏，篇幅仍是数百字。窄栏在较窄的一栏。选项在两栏之下，直接可见。窄屏时宽栏在上。
可替换：数据项的名称、条数和当前值，窄栏的标题和条目，配色和字体。本局没有窄栏时删掉窄栏，正文占回整宽。
```

## sample

```sample
html:
<div id="app">
  <p id="heading"></p>
  <div id="cards"></div>
  <div class="pair">
    <article id="body"></article>
    <aside class="side">
      <p id="side-title"></p>
      <div id="side"></div>
    </aside>
  </div>
  <ol id="options"></ol>
</div>

css:
:root { color: #1c2420; background: #d5ddd4; }
#app { max-width: 52rem; margin: 0 auto; padding: 1rem; font: 15px/1.75 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
#heading { margin: 0 0 0.6rem; font-size: 13px; }
#cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.45rem; margin-bottom: 0.75rem; }
#cards.stack { grid-template-columns: 1fr; }
.card { padding: 0.4rem 0.55rem; border-radius: 4px; background: rgba(255,255,255,0.72); }
.card b { display: block; font-size: 12px; font-weight: 600; color: #5c6b62; }
.card span { font-size: 1.05rem; font-weight: 650; }
.pair { display: grid; grid-template-columns: 1.65fr 0.72fr; gap: 0.7rem; align-items: start; }
#body { margin: 0; padding: 0.85rem 1rem; border-radius: 6px; background: #f7faf6; }
.side { padding: 0.55rem 0.65rem; border-radius: 6px; background: rgba(22,28,26,0.88); color: #f2f4f2; font-size: 13px; line-height: 1.45; }
#side-title { margin: 0 0 0.15rem; padding-bottom: 0.35rem; border-bottom: 1px solid rgba(255,255,255,0.16); font-weight: 700; }
#options { margin: 0.75rem 0 0; padding: 0; list-style: none; }
#options li { margin-top: 0.35rem; padding: 0.35rem 0.7rem; border-radius: 4px; background: rgba(255,255,255,0.72); }
@media (max-width: 720px) { .pair, #cards { grid-template-columns: 1fr; } }

js:
present.onData(function (data) {
  var blocks = (data && data.blocks) || {};
  putText("heading", blocks.heading);
  putText("side-title", blocks.side_title);
  putText("body", blocks.body);
  putCards("cards", blocks.cards);
  putLines("side", blocks.side);
  putList("options", blocks.options);
});
function putText(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  if (value == null || value === "") { el.remove(); return; }
  el.textContent = String(value);
}
function putCards(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  el.replaceChildren();
  var rows = Array.isArray(value) ? value : [];
  if (!rows.length) { el.remove(); return; }
  var long = rows.some(function (row) { return String(row.value ?? "").length > 8; });
  el.classList.toggle("stack", long);
  rows.forEach(function (row) {
    var card = document.createElement("div");
    card.className = "card";
    var name = document.createElement("b");
    var num = document.createElement("span");
    name.textContent = String(row.name || "");
    num.textContent = String(row.value ?? "");
    card.appendChild(name);
    card.appendChild(num);
    el.appendChild(card);
  });
}
function putLines(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  el.replaceChildren();
  var rows = Array.isArray(value) ? value : [];
  if (!rows.length) { el.remove(); return; }
  rows.forEach(function (line) {
    var p = document.createElement("p");
    p.textContent = String(line && line.text != null ? line.text : line);
    el.appendChild(p);
  });
}
function putList(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  el.replaceChildren();
  if (!Array.isArray(value) || !value.length) { el.remove(); return; }
  value.forEach(function (line) {
    var li = document.createElement("li");
    li.textContent = String(line);
    el.appendChild(li);
  });
}
```
