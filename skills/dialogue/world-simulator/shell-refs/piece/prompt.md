# 成稿

## intro

```intro
一次只放一份能单独拿走的成稿。成稿内部的小节在创作时按这一局的范例重排。选项贴在成稿下面，始终直接可见。
```

## layout

```layout
id: piece
主区: 一份成稿
可加窄带: 文字选项
摆放:
  成稿: 居中。内部小节在创作时按范例重写
  文字选项: 成稿之后，始终直接可见
未启用的区不留空位。
```

## note

```note
不替换：一份成稿容器居中。选项在容器之后，直接可见。
可替换：容器内部的标记、分段、配色和字体。按本局这一份成品重写内部。样本内部与本局不同时整段替换，保留容器和选项的前后关系。
```

## sample

```sample
html:
<div id="app">
  <article id="piece"></article>
  <ol id="options"></ol>
</div>

css:
:root { color: #1c1916; background: #ebe6dc; }
#app { max-width: 34rem; margin: 0 auto; padding: 1.6rem 1.25rem 2rem; font: 16px/1.65 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
#piece { margin: 0; }
#options { margin: 1rem 0 0; padding-left: 1.15rem; }

js:
present.onData(function (data) {
  var blocks = (data && data.blocks) || {};
  putText("piece", blocks.piece);
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
