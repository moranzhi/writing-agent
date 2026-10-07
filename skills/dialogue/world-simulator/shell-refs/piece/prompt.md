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
  成稿: 外壳铺满宿主；成稿正文柱可限行长并水平居中
  文字选项: 成稿之后，始终直接可见
未启用的区不留空位。
```

## note

```note
不替换：外壳铺满宿主宽度；一份成稿容器。选项在容器之后，直接可见。
可替换：容器内部的标记、分段、配色和字体、成稿柱行长上限。按本局这一份成品重写内部。样本内部与本局不同时整段替换，保留容器和选项的前后关系。
```

## sample

```sample
html:
<div id="app">
  <article id="piece" data-block="piece"></article>
  <ol id="options" data-block="options"></ol>
</div>

css:
:root { color: #1c1916; background: #ebe6dc; }
#app { width: 100%; box-sizing: border-box; margin: 0; padding: 1.6rem 1.25rem 2rem; font: 16px/1.65 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
#piece, #options { max-width: 34rem; margin-inline: auto; }
#piece { margin: 0 auto; }
#options { margin: 1rem auto 0; padding-left: 1.15rem; }

js:
present.onData(function () {
  /* 成稿与选项由程序按 data-block 灌数 */
});
```
