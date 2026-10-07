# 分时

## intro

```intro
正文、小故事、数据卡、结构里有三块以上都要单独看。一次只显示一块，其余用标签切换。切换只改变当前视图。
```

## layout

```layout
id: paged
主区: 当前这一页
分页: 正文、小故事、数据卡、结构中本局启用且需要单独看的区
可加窄带: 抬头留在标签之外，始终可见
摆放:
  抬头: 标签之上
  标签: 一行，当前页加下划线。标签用本局该页的短名，不写区种类名
  页内: 按该区自己的读法排。数据卡用卡片。结构调用已固定的拓扑绘图渲染器，不输出节点清单。
未启用的区不建标签。
```

## note

```note
不替换：外壳铺满宿主宽度；同时只显示一页。页用一行标签切换。抬头在标签之外。
可替换：每个标签的短名、页内文字和数据项、配色和字体、页内正文柱行长上限。本局未启用的页不建标签。
```

## sample

```sample
html:
<div id="app">
  <p id="heading" data-block="heading"></p>
  <div id="tabs"></div>
  <div id="page" data-block="page"></div>
</div>

css:
:root { color: #1c1915; background: #f7f3ea; }
#app { width: 100%; box-sizing: border-box; margin: 0; padding: 1.25rem; font: 16px/1.65 "Segoe UI", "Source Han Sans SC", sans-serif; }
#heading, #tabs, #page { max-width: 44rem; margin-inline: auto; }
#tabs { display: flex; gap: 0.4rem; margin-bottom: 0.9rem; }
#tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; padding: 0.35rem 0.6rem; font: inherit; color: inherit; }
#tabs button[aria-current="true"] { border-bottom-color: #8a5a2b; }

js:
var pages = [];
var current = 0;
present.onData(function (data) {
  var blocks = (data && data.blocks) || {};
  pages = Array.isArray(blocks.pages) ? blocks.pages : [];
  current = 0;
  drawTabs();
  drawPage();
});
function drawTabs() {
  var el = document.getElementById("tabs");
  el.replaceChildren();
  pages.forEach(function (page, index) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = page.name;
    if (index === current) button.setAttribute("aria-current", "true");
    button.addEventListener("click", function () {
      current = index;
      drawTabs();
      drawPage();
    });
    el.appendChild(button);
  });
}
function drawPage() {
  var el = document.getElementById("page");
  var text = pages[current] ? pages[current].text : "";
  el.innerHTML = text ? present.markdown(String(text)) : "";
}
```
