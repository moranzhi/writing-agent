# 生成规则

> **状态：待完善** — 块格式见 `docs/world-simulator-modules.md`；范例见 `aesthetics-interaction`。

## meta

```meta
name: 生成规则
id: generation-rules
artifact: 设计.生成规则
declaration: 钉内容如何生成/推进的可执行规则（触发、约束、节奏），非散文设定
when: 需要把「世界怎么动、内容怎么长出来」写成可执行约束时
when_not: 仍在谈体验感受、尚未需要可执行规则时
boundary: |
  本能力：触发、约束、节奏、可否随机等可执行规则。
  变量设计与更新规则：字段与何时改值。
  实现机制：落到哪些 worker/表来执行这些规则。
```

## opening

```opening
```

## task

```task
钉清生成与推进规则，写入 设计.生成规则。须可被下游 worker/程序引用，禁止只写散文氛围。
（待作者细写）
```

## principles

```principles
可执行优于文采；与体验禁忌对齐。
```

## probe

```probe
（待作者细写）
```

## output

```output
{
  "触发": ["…"],
  "约束": ["…"],
  "节奏": "…",
  "例外": ["…"]
}
```

## checklist

```checklist
- [ ] 规则是否可被执行/检查，而非纯描写？
- [ ] 是否与体验边界禁忌冲突？
```
