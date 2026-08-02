# 游玩拓扑

> 能力文档。程序只切割下方 **fence 块**；`##` 标题仅供人读。  
> **禁止自由发明执行单元。** 只从固定槽勾选；程序按 `play_slots` 展开 workers。  
> 方法：`docs/progressive-data-design.md`；模板：`worker-templates/`。

## meta

```meta
name: 游玩拓扑
id: worker-spec
artifact: 设计.worker规格
declaration: >
  勾选固定游玩槽位（主世界层 / 叙事转述 / 可选角色视角 / 可选机遇裁定；写手路径为大纲+章节），
  禁止自由发明新的执行单元 ref
when: |
  体验契约已大致清楚，需要决定游玩期启用哪些固定槽时；
  或要修订已勾选槽位（开/关 perspective、chance 等）时。
when_not: |
  体验/站位仍混沌 → 先美学纲领与交互范式。
  只需收成完整运行规格 → 交给细化终稿（本步只交槽位勾选）。
  不要用本步「发明」世界观/性格/变量专用执行单元。
boundary: |
  本能力：输出 play_slots（及写手路径的 writing_slots），可选覆盖挂载说明；不写完整 设计.worker集。
  细化终稿：按本步勾选展开 workers、合并常驻与 tables。
  变量设计 / 变量控制上下文：真值与投影，不是推理槽。
  机遇裁定（chance）：按需程序工具槽，不进每轮管线。
  叙事指南与故事推进：挂到转述槽（推进可兼挂主世界层）；世界/机制：挂到主世界层——本步只点名槽。
```

## opening

```opening
游玩时用哪些固定槽？（只勾选，不要发明新角色名当「新系统」）

世界模拟类常见：
1. 主世界层（裁决，几乎总要）——要 / 不要
2. 叙事转述（写你看见的正文，几乎总要）——要 / 不要
3. 角色视角（仅当有强秘密、不能进主世界层时）——要 / 不要（默认不要）
4. 机遇裁定（骰子/抽签/比点等真随机，按需调用、不进每轮）——要 / 不要（默认不要；有战斗检定、抽签事件时建议开）

写手/扩写类常见：大纲/细纲 + 章节正文（固定两槽，同上只勾选）。

变量、性格分档、世界观：不是槽，后面用变量/世界等技能收进上下文。
```

## task

```task
你正在执行「游玩拓扑」。产物写入「设计.worker规格」。

核心操作：让用户勾选固定槽，写成 `play_slots`（世界模拟）或 `writing_slots`（扩写）。**禁止**新建未在固定列表中的 ref。

固定 ref 白名单：
- 世界模拟每轮：`world-simulator`（gm）、`narrator`、`role-decide`（perspective，默认关）
- 世界模拟按需：`chance`（机遇裁定，默认关；invocation=on_demand）
- 扩写：`outline`、`chapter-writer`
- 禁止：`variable-update`、自造 kebab、为世界观/性格再拆槽

执行顺序：
1. 读配方与体验契约，判断路径：世界模拟 vs 写手分段。
2. 默认世界模拟：`gm: true, narrator: true, perspective: false, chance: false`；
   仅信息隔离才开 perspective；需要骰子/抽签/比点等真随机时开 chance。
3. 写手路径：`outline` + `chapter-writer` 默认都开；用户明确只要正文则可关 outline。
4. 可写简短 `mount_notes`（哪类上游产物挂哪槽），不粘贴长文。
5. 输出 JSON。summary：`游玩拓扑 · gm+转述` 或 `游玩拓扑 · gm+转述+机遇` 等。

若程序已发默认问题：禁止重复同一开场；在首答上补洞。
```

## principles

```principles
1. 只勾选，不发明：ref 必须在白名单内。
2. 默认少槽：世界模拟 = 主世界层 + 转述；perspective 默认关。
3. 变量 / Data / Progressive 不是执行单元。
4. 删掉检验仍适用：关某个槽要说得清损失什么。
5. 本步不输出完整 Worker 集、不写 tables 全文（交给细化终稿 / 变量设计）。
6. 可修订已有勾选，不要为「更聪明」加槽。
```

## probe

```probe
一次 1～2 点：

- 正文是否必须由独立转述写？（不要则 gm 兼呈现，narrator=false——需用户明确）
- 是否有「主世界层不该知道的角色秘密」？（有才 perspective=true）
- 扩写：要不要先验大纲再写章？

不要问「还想加什么 Worker」。
```

## output

```output
{
  "brief": "一句话：本局启用哪些固定槽",
  "path": "world_sim|writing",
  "play_slots": {
    "gm": true,
    "narrator": true,
    "perspective": false,
    "chance": false
  },
  "writing_slots": {
    "outline": true,
    "chapter_writer": true
  },
  "mount_notes": [
    "叙事指南与故事推进 → narrator（推进兼 gm）",
    "世界/机制/变量规则 → gm",
    "真随机检定 → chance（按需）",
    "真值与 side_effects → 细化终稿 tables"
  ],
  "开放问题": []
}
```

填写规则：
- `path=world_sim` 时必须有 `play_slots`；`writing_slots` 可省略。
- `path=writing` 时必须有 `writing_slots`；`play_slots` 可省略。
- `chance` 缺省视为 false；为 true 时不进每轮序，仅可按需调度。
- 不要输出自造 `actors[]` / 自由 `workers[]`。
- 旧产物若含 `actors[]`：本步应改写为槽位勾选，不再追加自定义 ref。

## checklist

```checklist
- [ ] 是否只有白名单槽，无自造 ref？
- [ ] perspective / chance / 只要正文等非常规选择是否有理由？
- [ ] 是否误把变量管理做成槽？是否误把 chance 当成每轮 LLM？
- [ ] 是否误交完整 设计.worker集？
```

## examples

```examples
好：
- play_slots: gm+narrator，perspective/chance false；mount_notes 一行。
- 有凶手真名不能进 GM：perspective true，并说明只出反应建议。
- 需要检定/抽签：chance true（按需程序工具）。

坏：
- actors 里发明 affinity-manager、lore-keeper、dice-master（LLM）。
- 为性格分档再拆一个执行单元。
```
