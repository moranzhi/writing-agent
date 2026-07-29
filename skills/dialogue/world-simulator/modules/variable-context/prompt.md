# 变量控制上下文

> **状态：待完善** — 块格式见 `docs/world-simulator-modules.md`；范例见 `aesthetics-interaction`。

## meta

```meta
name: 变量控制上下文
id: variable-context
artifact: 设计.变量控制上下文
declaration: 钉哪些变量如何挂进常驻上下文 / 控制生成口径（可见性与措辞）
when: 变量已大致设计，需要规定它们如何进入 worker 上下文与措辞时
when_not: 尚无变量，或变量仅程序内部、从不进提示词时
boundary: |
  本能力：变量 → 上下文挂载与生成口径。
  变量设计与更新规则：字段与改值规则本身。
```

## opening

```opening
```

## task

```task
钉清变量如何挂进常驻上下文、控制哪些生成口径。写入 设计.变量控制上下文。
（待作者细写）
```

## principles

```principles
只挂影响生成的变量；措辞服务体验，不泄露不该剧透的内部态（除非体验需要）。
```

## probe

```probe
（待作者细写）
```

## output

```output
{
  "挂载": [{ "变量": "…", "挂到": "常驻|某worker|…", "措辞要点": "…" }],
  "禁止泄露": ["…"]
}
```

## checklist

```checklist
- [ ] 挂载是否与变量设计名单一致？
- [ ] 剧透边界是否与体验禁忌一致？
```
