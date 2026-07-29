# 设计回复格式

> **状态：待完善** — 块格式见 `docs/world-simulator-modules.md`；范例见 `aesthetics-interaction`。

## meta

```meta
name: 设计回复格式
id: reply-format
artifact: 设计.回复格式
declaration: 钉单轮可见输出的结构（正文块、面板、拼接顺序），服务体验契约
when: 需要钉单轮「用户看见什么、什么顺序」时（含多块拼接）
when_not: 美学纲领与交互范式里呈现已足够且无多块结构时
boundary: |
  本能力：单轮可见结构与拼接。
  设计状态栏：状态栏块的字段细则。
  美学纲领与交互范式：人称、系统扮演、体验边界——本步不重谈。
```

## opening

```opening
```

## task

```task
钉清单轮可见回复格式（块、顺序、可选面板），写入 设计.回复格式。对齐已验收的呈现契约。
（待作者细写）
```

## principles

```principles
结构服务体验；块要少；与状态栏/终稿 tag 约定一致。
```

## probe

```probe
（待作者细写）
```

## output

```output
{
  "块顺序": ["状态栏", "正文", "…"],
  "正文约定": "…",
  "可选面板": [],
  "终稿tag或拼装说明": "…"
}
```

## checklist

```checklist
- [ ] 是否与美学纲领的呈现/轮转一致？
- [ ] 状态栏块是否指向 设计.状态栏（若有）？
```
