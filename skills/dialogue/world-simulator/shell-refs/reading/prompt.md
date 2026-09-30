# 阅读

## intro

```intro
只展示正文。抬头、文字选项需要时贴在正文前后。本局没有的区从骨架删除。
```

## layout

```layout
id: reading
主区: 正文
可加窄带: 抬头、文字选项
摆放:
  抬头: 正文之前的一行短内容
  正文: 阅读柱，占主要宽度
  文字选项: 正文之后，始终直接可见，不放进标签或折叠。不显示「文字选项」这个区名
未启用的区不留空位。
```

## note

```note
不替换：单栏阅读柱。抬头在正文前，独占一行。选项在正文后，直接可见。
可替换：抬头文字、正文文字、配色和字体。本局没有抬头时删掉抬头。
```

## sample

```sample
html:
<div id="app">
  <p id="heading"></p>
  <article id="body"></article>
  <ol id="options"></ol>
</div>

css:
:root { color: #1c1915; background: #f7f3ea; }
#app { max-width: 38rem; margin: 0 auto; padding: 1.5rem 1.25rem 2.5rem; font: 17px/1.75 "Palatino Linotype", "Songti SC", serif; }
#heading { margin: 0 0 0.85rem; font-size: 0.95rem; letter-spacing: 0.04em; }
#body { font-size: 1.05rem; }
#options { margin: 1.25rem 0 0; padding-left: 1.2rem; }

js:
present.onData(function (data) {
  var blocks = (data && data.blocks) || {};
  putHeading("heading", blocks.heading);
  putText("body", blocks.body);
  putList("options", blocks.options);
});
function putHeading(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  el.replaceChildren();
  if (value == null || value === "") { el.remove(); return; }
  if (typeof value === "string") { el.textContent = value; return; }
  Object.keys(value).forEach(function (key) {
    var item = document.createElement("span");
    item.textContent = key + " " + String(value[key]);
    item.style.marginRight = "1rem";
    el.appendChild(item);
  });
}
function putText(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  if (value == null || value === "") { el.remove(); return; }
  el.textContent = String(value);
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
