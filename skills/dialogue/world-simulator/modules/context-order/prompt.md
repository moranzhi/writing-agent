# 上下文投影排序

> 技能文档。程序只切割下方 **fence 块**；`##` 标题仅供人读。  
> **本步只排出扁平投影序，不发明执行单元，不重写设定长文。**  
> 「对话.历史」也是可投影标签（改 projection 裁剪长度）；见 `docs/context-fragment-design.md`。

## meta

```meta
name: 上下文投影排序
id: context-order
artifact: 设计.上下文投影排序
declaration: >
  根据各上游上下文的概括，为每个启用槽写出扁平投影序
  （含对话.历史标签与 projection）；不发明槽、不重写正文
when: |
  游玩槽已确认（或可按默认），且主要上下文块已有可摘要产物，
  需要决定插入顺序与投影级别、再收成运行规格时。
when_not: |
  体验/站位仍混沌 → 先美学纲领与交互范式。
  槽位未定且用户拒绝默认 → 先游玩拓扑。
  上游上下文仍大量空洞、无法判断稳/变 → 先补缺口，勿空排。
  只需勾选槽 → 游玩拓扑；只需合并终稿 → 细化终稿。
boundary: |
  本技能：读各块概括 → 产出每槽 inserts[]（order / ref / projection / 可选 note）；须含对话.历史。
  无「历史前/后」硬分区；对话.历史本身是可排序的一项。
  游玩拓扑：槽位权威；本步不增白名单外 ref（含按需 chance 不进每轮序）。
  中段技能：可带 mount 与稳/变信号，最终 order 以本步为准。
  细化终稿：把本步排序表收进运行规格 context_order；本步不输出完整 设计.worker集。
feeds: design_only
```

## opening

```opening
准备排出各游玩槽的扁平投影序（只排序，不改设定正文）。

请确认或补充：
1. 启用槽是否仍是默认？（世界模拟：主世界层 + 叙事转述；角色视角默认关）
2. 「对话.历史」希望夹在哪、投影多狠？（默认 summary）
3. 有没有「几乎永不改」或「每轮必变」的块要特别强调？

若前面产物够用，可直接回复「按已有概括排序」。
```

## task

```task
你正在执行「上下文投影排序」。产物写入「设计.上下文投影排序」。

输入：已启用槽；各上游上下文的短摘要（及 mount / 稳变信号，若有）。
输出：按槽分组的格式化排序表——Runtime/终稿据此把投影插到固定位置。

规则：
1. 禁止发明执行单元或白名单外 ref。
2. 禁止重写上游长文；只写 order、ref、projection 与一句 note（勿再写硬锚点分区）。
3. 每槽扁平数字序：order 0＝该槽固定人设；其后按「稳→对话.历史→易变」软排。
4. 必须包含一项 ref=`对话.历史`（默认 projection=summary）；历史由程序维护，本步只决定夹在哪、投影多狠。
5. 常见块名用新 artifact：设计.舞台骨架 / 设计.叙事指南与故事推进 / 设计.正文组成 / 设计.监控栏 等。
6. 越稳越靠前；本轮输入/真值/裁决通常在历史之后。
7. 同一内容可挂多槽；chance 为按需槽，不必排进每轮 inserts。
8. summary：如 `投影排序 · 主世界层 N 条 · 含历史`。

若程序已发默认问题：禁止重复同一开场；在首答上产出表。
```

## principles

```principles
1. 晚排序：此时才能区分常变与重要；勿回退去发明新槽。
2. 概括驱动：凭摘要与稳变信号排序，不把百科全文再读一遍当创作。
3. 历史是标签：用投影裁剪，不要假装「整段历史永远在中间锚点」。
4. 缓存优先：少变块靠前；高频变块靠后。
5. 投影分级：full / summary / fields / fixed——历史默认 summary。
6. 可修订已有排序表；用户改稳变判断时只改序，不改上游产物 id。
```

## probe

```probe
一次 askUser 1～2 点，优先 options：
- 某块稳/变判断冲突时，问用户更偏「少改利缓存」还是「每轮必须看见」。
- 角色视角若开启，问哪些块禁止进主世界层。
已齐则直接产出，勿为凑问题而问。
```

## output

```output
{
  "schema": "context-order.v1",
  "brief": "一句话：本局扁平投影序（含对话.历史）",
  "play_slots": { "gm": true, "narrator": true, "perspective": false },
  "slots": [
    {
      "ref": "world-simulator",
      "label": "主世界层",
      "inserts": [
        { "order": 0, "ref": "worker.persona", "projection": "fixed", "note": "槽位人设" },
        { "order": 1, "ref": "设计.实现机制", "projection": "summary", "note": "承重规则摘要" },
        { "order": 2, "ref": "对话.历史", "projection": "summary", "note": "按投影裁剪" },
        { "order": 3, "ref": "变量.当前", "projection": "fields", "note": "真值" },
        { "order": 4, "ref": "用户.最新输入", "projection": "full", "note": "本轮" }
      ]
    },
    {
      "ref": "narrator",
      "label": "叙事转述",
      "inserts": [
        { "order": 0, "ref": "worker.persona", "projection": "fixed", "note": "转述人设" },
        { "order": 1, "ref": "设计.叙事指南与故事推进", "projection": "summary" },
        { "order": 2, "ref": "对话.历史", "projection": "summary" },
        { "order": 3, "ref": "运行.本轮.裁决", "projection": "full", "note": "settlement" }
      ]
    }
  ]
}
```

## checklist

```checklist
- [ ] 未发明白名单外执行单元
- [ ] 未重写上游长文，只有排序/投影
- [ ] 每启用槽有 order 0 人设位
- [ ] 每槽含「对话.历史」且有合理 projection
- [ ] 少变块整体靠前、本轮/真值靠后（软规则）
- [ ] 与游玩拓扑勾选一致
```
