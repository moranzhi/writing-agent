# 对照

## intro

```intro
正文和一块结构同时在屏上。谁占主面积按本局定。抬头可贴在这一行的上沿。
```

## layout

```layout
id: alongside
主区: 正文与结构，并排
可加窄带: 抬头、文字选项
摆放:
  抬头: 最上的一行短内容
  正文: 一栏
  结构: 另一栏。创作时写一次绘图渲染器并固定；游玩把运行拓扑的节点与连接灌进去出图。不把节点写成清单。折叠标题用本局这块内容的短名
  文字选项: 最下，始终直接可见，不放进标签或折叠
窄屏改为上下排列。未启用的区不留空位。
```

## note

```note
不替换：正文和结构同屏。窄屏改为上下。选项在最下，直接可见。结构用创作时固定的绘图器，游玩灌入拓扑。
可替换：两栏谁更宽、抬头文字、结构块的短名、配色和字体。本局没有结构时改用阅读或正文为主。
```

## sample

```sample
html:
<div id="app">
  <p id="heading"></p>
  <div class="pair">
    <article id="body"></article>
    <section id="structure">
      <div id="graph"></div>
    </section>
  </div>
  <ol id="options"></ol>
</div>

css:
:root { color: #1c1915; background: #f7f3ea; }
#app { max-width: 56rem; margin: 0 auto; padding: 1.25rem; font: 16px/1.6 "Palatino Linotype", "Songti SC", serif; }
.pair { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 1rem; }
#structure { border: 1px solid #d5cbb8; border-radius: 6px; padding: 0.8rem; background: #fffdf8; }
#graph { min-height: 8rem; }
#options { margin: 1rem 0 0; padding-left: 1.2rem; }
@media (max-width: 720px) { .pair { grid-template-columns: 1fr; } }

js:
present.onData(function (data) {
  var blocks = (data && data.blocks) || {};
  putText("heading", blocks.heading);
  putText("body", blocks.body);
  putGraph("graph", blocks.structure);
  putList("options", blocks.options);
});
function putText(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  if (value == null || value === "") { el.remove(); return; }
  el.textContent = String(value);
}
function putGraph(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  el.replaceChildren();
  var nodes = value && Array.isArray(value.nodes) ? value.nodes : [];
  var links = value && Array.isArray(value.links) ? value.links : [];
  if (!nodes.length) { el.remove(); return; }
  var step = 120;
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 " + Math.max(nodes.length * step, step) + " 92");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "92");
  var at = {};
  nodes.forEach(function (node, i) { at[node.id] = i; });
  links.forEach(function (link) {
    var a = at[link.from];
    var b = at[link.to];
    if (a == null || b == null) return;
    var line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("x1", 48 + a * step);
    line.setAttribute("y1", 34);
    line.setAttribute("x2", 48 + b * step);
    line.setAttribute("y2", 34);
    line.setAttribute("stroke", "#8a5a2b");
    svg.appendChild(line);
  });
  nodes.forEach(function (node, i) {
    var x = 48 + i * step;
    var circle = document.createElementNS(svg.namespaceURI, "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", 34);
    circle.setAttribute("r", 14);
    circle.setAttribute("fill", node.current ? "#1c1915" : "#fffdf8");
    circle.setAttribute("stroke", "#1c1915");
    var label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", x);
    label.setAttribute("y", 70);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "12");
    label.textContent = String(node.name || node.id || "");
    svg.appendChild(circle);
    svg.appendChild(label);
  });
  el.appendChild(svg);
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
