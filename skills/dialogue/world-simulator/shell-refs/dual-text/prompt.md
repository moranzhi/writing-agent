# 双文

## intro

```intro
正文占满阅读宽度。短文和结构用标签或折叠，点开才看。选项始终直接可见。
```

## layout

```layout
id: dual-text
主区: 正文
可加: 短文、结构、数据、抬头、文字选项
摆放:
  抬头: 最上的一行短内容
  正文: 占满阅读宽度，按数百字来写
  短文、结构: 标签或折叠，点开才看。标签用短显示名
  数据: 若有，默认可收起
  文字选项: 始终直接可见，不放进标签或折叠
未启用的区不留空位。
```

## note

```note
不替换：正文占满阅读宽度。其余块收在标签或折叠里，默认不展开。选项在这些控件之外，直接可见。
可替换：标签和折叠的短名、收起块里的文字、配色和字体。本局没有的块删掉。数据要一直展开时改用数据常驻。
```

## sample

```sample
html:
<div id="app">
  <p id="heading"></p>
  <article id="body"></article>
  <details>
    <summary id="vignette-title"></summary>
    <div id="vignette"></div>
  </details>
  <ol id="options"></ol>
</div>

css:
:root { color: #1c1915; background: #f7f3ea; }
#app { max-width: 40rem; margin: 0 auto; padding: 1.25rem; font: 17px/1.75 "Palatino Linotype", "Songti SC", serif; }
#heading { margin: 0 0 0.8rem; font-size: 0.95rem; }
#vignette { font-size: 0.92rem; margin-top: 0.6rem; }
#options { margin: 0.8rem 0 0; padding-left: 1.2rem; }
summary { cursor: pointer; }

js:
present.onData(function (data) {
  var blocks = (data && data.blocks) || {};
  putText("heading", blocks.heading);
  putText("body", blocks.body);
  putText("vignette-title", blocks.vignette_title);
  putText("vignette", blocks.vignette);
  putList("options", blocks.options);
});
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
