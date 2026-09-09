# 游玩拓扑

> 能力文档。程序只切割下方 **fence 块**；`##` 标题仅供人读。  
> **禁止自由发明执行单元。** 只从固定槽勾选；程序按 `play_slots` 展开 workers。  
> 方法：`docs/progressive-data-design.md`；模板：`worker-templates/`。  
> 真随机：不靠「机遇裁定」槽；上游定法则 →「随机范围整理」收表 → 程序往消息隐藏区插备用数。

## meta

```meta
name: 游玩拓扑
id: worker-spec
artifact: 设计.worker规格
declaration: >
  不能吃默认槽时才勾选：主世界层必开；转述默认关（要独立文风层才开）；有变量/表维护才开旁观；强秘密才开视角；写手则大纲+章节；禁止发明执行单元与机遇槽
when: |
  体验契约已大致清楚，且不能吃默认槽：要开转述、开旁观、开角色视角（强秘密不能进主世界层），或走写手大纲+章节。
  或要修订已勾选槽（开/关 auditor、perspective、narrator 等）。
when_not: |
  体验/站位仍混沌 → 先「美学纲领与交互范式」。
  世界模拟可吃默认（仅主世界层；转述/旁观/视角关）→ 可不排，「细化终稿」按默认收成。
  只需输出完整运行规格 → 「细化终稿」（本步只交槽位勾选）。
  检定/掷骰范围汇总 → 「随机范围整理」；不要为本步加「机遇裁定」槽。
  不要用本步发明世界观/性格/变量专用执行单元。
boundary: |
  本能力：输出 play_slots（及写手路径的 writing_slots），可选覆盖挂载说明；不写完整 设计.worker集。
  主世界层（gm）几乎总要。转述默认关：主世界层直接交用户可见原文。旁观维护：有变量/表/规则要程序化盯时才开。
  不再设机遇裁定（chance）槽：真随机走「随机范围整理」+ 程序插入上下文备用数。
  细化终稿：按本步勾选展开 workers、合并常驻与 tables。
  变量设计 / 变量控制上下文：真值与投影，不是推理槽。
  叙事指南与故事推进：默认挂主世界层；若开了转述可挂转述（推进可兼挂主世界层）；世界/机制：挂到主世界层——本步只点名槽。
```

## opening

```opening
游玩时用哪些固定槽？（只勾选，不要发明新角色名当「新系统」）

世界模拟类常见：
1. 主世界层（推进 + 默认直接写可见正文）——要（几乎总要）
2. 叙事转述（读主世界正文再改写/镶壳；可补残稿）——要 / 不要（默认不要）
3. 旁观维护（有变量/表/规则要盯时才开；默认不要）——要 / 不要
4. 角色视角（仅当有强秘密、不能进主世界层时）——要 / 不要（默认不要）

不要勾「机遇裁定」：检定/掷骰用「随机范围整理」收表，程序插备用随机数。

写手/扩写类常见：大纲/细纲 + 章节正文（固定两槽，同上只勾选）。

变量、性格分档、世界观：不是槽，用变量/世界等技能收进上下文。
```

## task

```task
你正在执行「游玩拓扑」。产物写入「设计.worker规格」。

核心操作：让用户勾选固定槽，写成 `play_slots`（世界模拟）或 `writing_slots`（扩写）。**禁止**新建未在固定列表中的 ref；**禁止**再开机遇裁定槽。

固定 ref 白名单：
- 世界模拟每轮：`world-simulator`（gm）、`narrator`、`auditor`（回合末）、`role-decide`（perspective，默认关）
- 扩写：`outline`、`chapter-writer`
- 禁止：`chance` / 机遇裁定、`variable-update`、自造 kebab、为世界观/性格再拆槽

执行顺序：
1. 读配方与体验契约，判断路径：世界模拟 vs 写手分段。
2. 默认世界模拟：`gm: true, narrator: false, auditor: false, perspective: false`；
   调度序 gm → perspective? → narrator? → auditor?；
   主世界层必开（用户明确只要旁观/写手路径除外）；
   要独立文风改写才 narrator true；有变量设计/表维护需求 → auditor true；
   仅信息隔离才开 perspective。
3. 写手路径：`outline` + `chapter-writer` 默认都开；用户明确只要正文则可关 outline。
4. 可写简短 `mount_notes`（哪类上游产物挂哪槽），不粘贴长文。
5. 输出 JSON。summary：`游玩拓扑 · 仅 gm` 或 `游玩拓扑 · gm+转述` 等（勿写机遇）。

若程序已发默认问题：禁止重复同一开场；在首答上补洞。
```

## principles

```principles
1. 只勾选，不发明：ref 必须在白名单内；无机遇裁定槽。
2. 默认：世界模拟 = 仅主世界层；转述/旁观/perspective 默认关。主世界层必要。
3. 要独立文风层再开转述；有变量/表/规则要盯再开旁观。
4. 变量 / Data / Progressive 不是执行单元；旁观维护只出 maintain.v1，不写真相。
5. 删掉检验仍适用：关某个槽要说得清损失什么。
6. 本步不输出完整 Worker 集、不写 tables 全文、不写随机范围表（交给细化终稿 / 变量设计 / 随机范围整理）。
7. 可修订已有勾选，不要为「更聪明」加槽。
```

## probe

```probe
一次 1～2 点：

- 是否必须独立转述改写正文？（要才 narrator=true；默认不要，主世界层原文即终稿）
- 是否有「主世界层不该知道的角色秘密」？（有才 perspective=true）
- 有变量/表要盯却关了旁观？或无状态却硬开旁观？
- 扩写：要不要先验大纲再写章？

不要问「还想加什么 Worker」；不要问要不要机遇裁定。
```

## output

```output
{
  "brief": "一句话：本局启用哪些固定槽",
  "path": "world_sim|writing",
  "play_slots": {
    "auditor": false,
    "gm": true,
    "narrator": false,
    "perspective": false
  },
  "writing_slots": {
    "outline": true,
    "chapter_writer": true
  },
  "mount_notes": [
    "生成规则/变量合同/旁观摘要 → auditor（仅开旁观时；无长对话史）",
    "叙事指南与故事推进 → gm（默认）；若开转述可挂 narrator",
    "世界/机制/变量规则 → gm",
    "随机范围整理 → gm（上下文备用随机数；无机遇槽）",
    "真值与 side_effects → 细化终稿 tables"
  ],
  "开放问题": []
}
```

填写规则：
- `path=world_sim` 时必须有 `play_slots`；`writing_slots` 可省略。
- `path=writing` 时必须有 `writing_slots`；`play_slots` 可省略。
- `play_slots.gm` 世界模拟路径下应为 true。
- `narrator` 缺省按 false（主世界层兼呈现）；仅用户明确要独立文风层时 true。
- `auditor` 缺省按 false；有变量/表维护意图才 true。
- 不要输出 `chance` 字段；旧产物若有 `chance: true`，本步改为 false/删除，并指向「随机范围整理」。
- 不要输出自造 `actors[]` / 自由 `workers[]`。
- 旧产物若含 `actors[]`：本步应改写为槽位勾选，不再追加自定义 ref。

## checklist

```checklist
- [ ] 是否只有白名单槽，无自造 ref、无机遇裁定？
- [ ] 主世界层是否开启（世界模拟路径）？旁观是否与变量需求一致？
- [ ] auditor / perspective / 只要正文等非常规选择是否有理由？
- [ ] 是否误把变量管理做成槽？是否误交完整 设计.worker集？
```

## examples

```examples
好：
- play_slots: 仅 gm；转述/旁观/perspective false。
- 用户明确要独立文风：gm+narrator；有变量再加旁观。
- 有凶手真名不能进 GM：perspective true，并说明只出反应建议。
- 需要检定：不写 chance；提醒排「随机范围整理」。

坏：
- actors 里发明 affinity-manager、lore-keeper、dice-master（LLM）。
- 为性格分档再拆一个执行单元；或再开机遇裁定槽。
```
