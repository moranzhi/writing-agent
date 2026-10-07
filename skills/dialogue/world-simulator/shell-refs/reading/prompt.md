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
  正文: 阅读柱；外壳铺满宿主，行长可限在正文柱
  文字选项: 正文之后，始终直接可见，不放进标签或折叠。不显示「文字选项」这个区名
未启用的区不留空位。
```

## note

```note
不替换：外壳铺满宿主宽度；单栏阅读柱。抬头在正文前，独占一行。选项在正文后，直接可见。
可替换：抬头文字、正文文字、配色和字体、正文柱行长上限。本局没有抬头时删掉抬头。
```

## sample

```sample
html:
<div id="app">
  <p id="heading" data-block="heading"></p>
  <article id="body" data-block="body"></article>
  <ol id="options" data-block="options"></ol>
</div>

css:
:root { color: #1c1915; background: #f7f3ea; }
#app { width: 100%; box-sizing: border-box; margin: 0; padding: 1.5rem 1.25rem 2.5rem; font: 17px/1.75 "Palatino Linotype", "Songti SC", serif; }
#heading, #body, #options { max-width: 38rem; margin-inline: auto; }
#heading { margin: 0 0 0.85rem; font-size: 0.95rem; letter-spacing: 0.04em; }
#body { font-size: 1.05rem; }
#options { margin: 1.25rem auto 0; padding-left: 1.2rem; }

js:
present.onData(function () {
  /* 正文/抬头/选项由程序按 data-block 灌数；本地交互再写这里 */
});
```
