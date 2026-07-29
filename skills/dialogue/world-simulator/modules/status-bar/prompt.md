# 设计状态栏

> **状态：待完善** — 块格式见 `docs/world-simulator-modules.md`；范例见 `aesthetics-interaction`。

## meta

```meta
name: 设计状态栏
id: status-bar
artifact: 设计.状态栏
declaration: 钉用户可见状态栏：字段、刷新时机、与正文如何拼装
when: 体验需要程序拼状态栏+正文，或用户要持续可见关键状态时
when_not: 纯单段叙事、明确不要 HUD/状态条时
boundary: |
  本能力：可见状态栏字段与刷新/拼装。
  变量设计与更新规则：背后变量如何变。
  设计回复格式：整轮输出结构（状态栏可为其一块）。
```

## opening

```opening
```

## task

```task
钉清用户可见状态栏：字段、来源、刷新时机、与正文拼装方式。写入 设计.状态栏。
（待作者细写）
```

## principles

```principles
只展示影响决策或沉浸的字段；与变量设计对齐。
```

## probe

```probe
（待作者细写）
```

## output

```output
{
  "字段": [{ "名": "…", "来源": "…", "可见条件": "…" }],
  "刷新": "每轮|事件|…",
  "拼装": "状态栏在正文前|后|旁|…"
}
```

## checklist

```checklist
- [ ] 每个字段是否有变量/表来源？
- [ ] 是否与回复格式拼装不冲突？
```
