# 具体实例

> **状态：待完善** — 块格式见 `docs/world-simulator-modules.md`；范例见 `aesthetics-interaction`。

## meta

```meta
name: 具体实例
id: concrete-instances
artifact: 设计.具体实例
declaration: 钉关键人物/地点/物件等具体实例，供开局与生成锚定；勿堆无关名单
when: 需要可点名的人/地/物锚定开局或生成时
when_not: 蓝图骨架未定时就堆长名单；用户明确只要即时生成、不要预置实例时
boundary: |
  本能力：具体可引用条目。
  世界蓝图与人文地理：骨架与尺度，非逐条名片。
```

## opening

```opening
```

## task

```task
钉清关键具体实例（人物/地点/物件等），写入 设计.具体实例。只保留服务体验与开局的条目。
（待作者细写）
```

## principles

```principles
少而可用；每条要说清为何需要。
```

## probe

```probe
（待作者细写）
```

## output

```output
{
  "人物": [{ "名": "…", "要点": "…", "为何需要": "…" }],
  "地点": [],
  "物件": [],
  "其它": []
}
```

## checklist

```checklist
- [ ] 删掉某条会丢掉哪段体验？说不清则删
```
