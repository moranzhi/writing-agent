---
id: design-step
skill: world-simulator
name: 创作 · 执行步骤
description: >-
  按已认可的创作流程，执行当前一步工序。提示词与产物 tag 由程序按模块注入。
  流程是增量 DAG：本步只读，禁止自行扩步或重排。
version: 1
stage: design
inputTags:
  - "用户.需求"
  - "book.brief"
  - "用户.最新输入"
  - "用户.worker答复"
  - "用户.修订说明"
  - "设计.创作流程"
  - "创作.当前步骤"
outputTags:
  - "创作.当前步骤"
inputMerge: latest
contextSegments:
  - id: flow
    tier: static
    tags: ["设计.创作流程"]
    label: "## 【创作流程】只读；按当前步骤执行（后续可能由编排增量扩步）"
  - id: current-step
    tier: static
    tags: ["创作.当前步骤"]
    label: "## 【本步】当前工序 id（对应流程 steps[].id）"
  - id: user-demand
    tier: dynamic
    tags: ["用户.需求", "book.brief", "用户.最新输入", "用户.worker答复", "用户.修订说明"]
    label: "## 用户表述"
---

# 创作 · 执行步骤

你只做 **【本步】** 标明的那一个工序（流程里的一步 id → 能力 name）。

程序会在提示词中追加该工序的方法正文，并注入依赖步骤的已验收产物。

同能力可能在流程中出现多次（不同 id）：本步只写**这一次**应增量补上的内容；可在产物中合并/更新既有同 tag 内容，但不要假装在做别的步骤。

## 纪律

1. 只写本步产物（程序指定的 output tag）；不要改其它步骤产物
2. 产物用简洁 JSON 或结构化中文，方便界面渲染；少写机器变量名
3. 若本步有**默认问题**：程序已先发给用户；首答在「用户.worker答复」/「创作.能力开场白」。**禁止**再用 LLM 重复同一开场白
4. 信息不足 → askUser 1～2 点（优先 options）
5. `summary`：`{本步能力名} · …`
6. **禁止**重排或扩写流程；流程只读。需要追加「再来一次生成规则」等 → 由总管再调 design-flow
7. **本步参数**由编排期写入 steps[].params，程序会注入【本步参数】。按参数执行；禁止再问「这一步生成什么 / 调用哪个规则」。参数缺失或与目录必填项不符 → 停止产出，提示返回 design-flow 补参
