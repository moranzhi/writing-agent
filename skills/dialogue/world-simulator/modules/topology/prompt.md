# 拓扑图谱

> **状态：待完善** — 块格式见 `docs/world-simulator-modules.md`；范例见 `aesthetics-interaction`。

## meta

```meta
name: 拓扑图谱
id: topology
artifact: 设计.拓扑图谱
declaration: 钉 worker/表/阶段的依赖、触发与数据流向；一张图说清谁读谁写
when: 实现机制大致清楚，需要钉依赖边、触发边与数据流向时
when_not: 尚未决定有哪些执行单元就先画复杂图
boundary: |
  本能力：依赖/触发/读写流向。
  Worker 规格：单个单元契约。
  实现机制：总览「要哪些件」，本步钉件与件的边。
```

## opening

```opening
```

## task

```task
钉清拓扑：单元、依赖、触发、读写流向。写入 设计.拓扑图谱。
（待作者细写）
```

## principles

```principles
一张图说清；环依赖与隐式读写必须显式写出或拆掉。
```

## probe

```probe
（待作者细写）
```

## output

```output
{
  "节点": [{ "id": "…", "类型": "worker|表|阶段|…" }],
  "边": [{ "from": "…", "to": "…", "关系": "依赖|触发|读写|…" }],
  "说明": "…"
}
```

## checklist

```checklist
- [ ] 每个关键读写是否有边？
- [ ] 是否与实现机制列表一致？
```
