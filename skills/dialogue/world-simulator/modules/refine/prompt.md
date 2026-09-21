# 细化终稿

> 能力文档。程序只切割下方 **fence 块**；`##` 标题仅供人读。  
> 产物 tag：**`设计.worker集`**（JSON）。  
> **禁止自由发明 workers。** 按上游「游玩拓扑」的 `play_slots` / `writing_slots` 展开。

## meta

```meta
name: 细化终稿
id: refine
artifact: 设计.worker集
declaration: >
  按已勾选槽（或默认槽）与投影排序表收成运行规格；不发明新执行单元
when: |
  至少体验契约可引用；槽已勾选或可按默认；若上下文块已多则宜先有投影排序表。
  需要输出「设计.worker集」才能进游玩时排；编排应将流程导向 closed。
when_not: |
  体验站位未定 → 先「美学纲领与交互范式」。
  不能吃默认槽且尚未勾选 → 先「游玩拓扑」。
  上下文块已多且稳/变未排序 → 先「上下文投影排序」。
  只要改某一块设定长文 → 回头修改对应上游节点，不要用本步重写。
boundary: |
  本能力：合并上游 → 完整运行规格 JSON（interaction、play_slots、context_order/inserts、
  workers 由槽展开、resident_context、tables）。
  游玩拓扑：槽位权威；上下文投影排序：插入序与投影位权威；本步不新增白名单外的 ref。
  变量设计：side_effects / 真值吸入 tables；不创建 variable-update 执行单元。
  进 play 由用户手动决定。
```

## opening

```opening
准备收成可进游玩的规格。请确认或补充：

1. 还有没有「绝不能瞎发挥」的前提？（一句一条）
2. 槽位是否按上游拓扑？（世界模拟默认：仅主世界层；转述/旁观默认关；写手默认：大纲+章节）有无要改的勾选？
3. 若已有「上下文投影排序」，是否按该表收成？（不要在本步重排）
4. 要不要表/状态门控？（不要就写「不要」）

若前面产物已经够用，可直接回复「按已有产物收成」。
```

## task

```task
你正在执行「细化终稿」。产物必须写入 **设计.worker集**，且为 **JSON**。

本步是收成，不是发明新执行单元。优先合并：
- 设计.美学纲领与交互范式 → interaction / experience_check
- 设计.worker规格（游玩拓扑）→ play_slots 或 writing_slots
- 设计.上下文投影排序 → 写入规格的 context_order（每槽 inserts：order/anchor/ref/projection）；无表且上下文很少时可按默认 static/dynamic 退化
- 设计.叙事指南 / 设计.故事推进（工序编排：设计.叙事指南与故事推进）/ 世界 / 机制 / 生成规则等 → resident_context（挂载以排序表与 mount 为准，本步不重排数字序）
- 设计.变量设计与更新规则 → tables.side_effects（及 schemas 摘要）
- 设计.变量控制上下文 → 核对挂载与剧透，写入 notes 或 resident 短句

执行顺序：
1. 复述站位、体验内核、禁忌；矛盾处 askUser 1 点。
2. 写入 `play_slots`（世界模拟）或等价写手槽；**workers 只含白名单 ref**：
   - world_sim 默认：仅 world-simulator（gm）；可选 role-decide / narrator / auditor
   - world_sim 每轮顺序（启用的槽）：world-simulator（gm）→ role-decide（仅 perspective 开）→ narrator（仅开转述）→ auditor
   - world_sim 机遇：`play_slots.chance` 开时 gm harness 获批量工具；可另声明 `chance` ref（`invocation: on_demand`）供显式调度
   - writing：outline / chapter-writer
   - 程序也会按 play_slots 展开；你仍应写出与槽一致的 workers[]（含 acceptance），便于人读验收。
3. **禁止**自造 ref、禁止添加 variable-update / lore-keeper / 自造骰子 LLM 等。
4. resident_context：稳定句挂到 gm（无转述时叙事指南也挂 gm）；开了转述可挂 narrator；旁观合同可挂 auditor；勿塞聊天过程。
5. tables：吸入变量设计的 side_effects；无则空数组或省略。
6. core_premises、design_end.opening 按需。
7. summary：`细化终稿 · 槽 仅 gm · …` 或 `细化终稿 · 槽 gm+转述 · …` 或 `细化终稿 · 大纲+章节 · …`

进游玩不在本步完成。
```

## principles

```principles
1. 合并优于重写；槽位优于发明演员。
2. 面向用户的终稿点 acceptance=review（默认是 world-simulator；开了转述则是 narrator；写手是 chapter-writer）；旁观/outline 常用 continue；有转述时 gm 用 continue。
3. 真值变更主路径：旁观维护 maintain.v1（读本轮正文改表）；可选正文隐藏段维护语句。主世界层只写故事正文，不交 settlement 裁决包。
4. 正文约定：主世界层始终写「输出.用户展示」（Markdown）。无转述时原文即终稿；有转述时转述读该正文再提取/改写/镶壳并覆盖终稿。
5. 键名稳定；未决进 open_questions。
```

## probe

```probe
只问挡住收成的矛盾：

- 拓扑与用户本轮说法冲突时以谁为准？
- 有表需求但副作用未定：先不要表，还是只钉 1～2 条 side_effects？

不要问「还要加哪个 Worker」。
```

## output

```output
{
  "version": 1,
  "form_summary": "一句话体验",
  "interaction": {
    "user_stance": "…",
    "system_role": "…",
    "output": "…",
    "turn_shape": "对话回合|助手分段|…"
  },
  "experience_check": {
    "user_relation": "…",
    "focus": "…",
    "satisfaction_source": "…"
  },
  "play_slots": {
    "auditor": false,
    "gm": true,
    "narrator": false,
    "perspective": false
  },
  "workers": [
    {
      "name": "主世界层",
      "ref": "world-simulator",
      "duty": "读投影与真值，直接写用户可见正文（无独立转述）",
      "when": "每轮用户输入后",
      "rationale": "默认少槽：原文即终稿",
      "acceptance": "review"
    }
  ],
  "resident_context": [
    {
      "id": "experience-contract",
      "position": "static",
      "content": "体验/禁忌压缩句",
      "mount": ["world-simulator"]
    }
  ],
  "tables": {
    "schemas": [],
    "side_effects": []
  },
  "core_premises": ["…"],
  "input_protocol": {
    "parens": "() 元要求",
    "quotes": "\"\" 角色对白",
    "bare": "无包裹按站位解释"
  },
  "design_end": {
    "opening": "optional"
  },
  "open_questions": []
}
```

写手路径示例：不要 `play_slots`，workers 仅 `outline` + `chapter-writer`（acceptance 按是否验大纲）。

必须是可解析 JSON。每个 workers[] 元素必须有 acceptance，且 ref ∈ 白名单。

## checklist

```checklist
- [ ] 是否含 play_slots（世界模拟）或仅白名单写手 workers？
- [ ] 有无白名单外的 ref？
- [ ] interaction 是否与美学纲领一致？
- [ ] side_effects 是否来自变量设计（或明确不要表）？
- [ ] 有无把变量管理做成额外 worker？
```

## examples

```examples
好：
- play_slots 仅 gm；workers 与槽一致；side_effects 从变量设计拷入（或明确不要表）。
- 用户明确要转述：gm continue + narrator review。
- 扩写：outline continue + chapter-writer review；无自造 ref。

坏：
- 自由发明 affinity-agent、world-lore-worker。
- 无 play_slots 却塞了 6 个自定义 workers。
- YAML 或半散文
```
