# 变量设计与更新规则

> **状态：待完善** — 块格式见 `docs/world-simulator-modules.md`；范例见 `aesthetics-interaction`。

## meta

```meta
name: 变量设计与更新规则
id: variable-design
artifact: 设计.变量设计与更新规则
declaration: 钉变量字段、初值与更新时机/规则；与表副作用对齐
when: 需要可追踪状态（进度、关系、资源等）且要写清谁何时改时
when_not: 无状态纯对话、或状态仅散文描述从不程序化时
boundary: |
  本能力：字段、初值、更新规则、与副作用。
  变量控制上下文：这些变量如何进入提示词口径。
  设计状态栏：哪些对用户可见。
```

## opening

```opening
```

## task

```task
钉清变量字段、初值与更新规则，写入 设计.变量设计与更新规则。与表/副作用命名对齐。
（待作者细写）
```

## principles

```principles
字段要少；更新规则可检查；禁止隐式改值。
```

## probe

```probe
（待作者细写）
```

## output

```output
{
  "变量": [
    {
      "名": "…",
      "类型": "…",
      "初值": "…",
      "更新": "谁、何时、怎么变"
    }
  ],
  "副作用备注": "…"
}
```

## checklist

```checklist
- [ ] 每个变量是否有明确更新者与时机？
- [ ] 是否与拓扑/表设计一致？
```
