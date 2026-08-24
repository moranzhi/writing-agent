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
  按已勾选固定槽与「上下文投影排序」表收成可进游玩的规格：
  play_slots、投影插入序、常驻上下文、表与副作用；不发明新执行单元
when: |
  前面技能已大致谈清（至少有体验契约；槽已勾选或可按默认；
  若已有多块上下文则宜先有投影排序表），需要输出「设计.worker集」JSON 时；
  编排应将流程 status 导向 closed。
when_not: |
  体验站位未定 → 先上游。
  拓扑未勾选且用户拒绝默认槽 → 先「游玩拓扑」。
  上下文块已多且稳/变未排序 → 先「上下文投影排序」。
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
2. 槽位是否按上游拓扑？（世界模拟默认：主世界层+转述；写手默认：大纲+章节）有无要改的勾选？
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
- 设计.叙事指南与故事推进（旧称 设计.叙事指南）/ 世界 / 机制 / 生成规则等 → resident_context（挂载以排序表与 mount 为准，本步不重排数字序）
- 设计.变量设计与更新规则 → tables.side_effects（及 schemas 摘要）
- 设计.变量控制上下文 → 核对挂载与剧透，写入 notes 或 resident 短句

执行顺序：
1. 复述站位、体验内核、禁忌；矛盾处 askUser 1 点。
2. 写入 `play_slots`（世界模拟）或等价写手槽；**workers 只含白名单 ref**：
   - world_sim 每轮（顺序）：world-simulator（gm）→ role-decide（仅 perspective 开）→ narrator → auditor
   - world_sim 机遇：`play_slots.chance` 开时 gm harness 获批量工具；可另声明 `chance` ref（`invocation: on_demand`）供显式调度
   - writing：outline / chapter-writer
   - 程序也会按 play_slots 展开；你仍应写出与槽一致的 workers[]（含 acceptance），便于人读验收。
3. **禁止**自造 ref、禁止添加 variable-update / lore-keeper / 自造骰子 LLM 等。
4. resident_context：稳定句挂到 gm 或 narrator（或 outline/chapter-writer）；旁观合同可挂 auditor；勿塞聊天过程。
5. tables：吸入变量设计的 side_effects；无则空数组或省略。
6. core_premises、design_end.opening 按需。
7. summary：`细化终稿 · 槽 旁观+gm+转述 · …` 或 `细化终稿 · 大纲+章节 · …`

进游玩不在本步完成。
```

## principles

```principles
1. 合并优于重写；槽位优于发明演员。
2. 面向用户的终稿点 acceptance=review（通常是 narrator 或 chapter-writer）；auditor/gm/outline 常用 continue。
3. 真值变更写在 gm 的 outputs（运行.本轮.变量变更 / 裁决包内 variable_changes），旁观维护只出 maintain.v1；不靠第三变量 Worker。
4. 裁决包约定：运行.本轮.裁决 使用 settlement.v1（见 progressive-data-design / 模板）；Runtime 合并 variable_changes。
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
    "auditor": true,
    "gm": true,
    "narrator": true,
    "perspective": false
  },
  "workers": [
    {
      "name": "旁观维护",
      "ref": "auditor",
      "duty": "表/规则检查；maintain.v1；默认空操作；无长对话史",
      "when": "每轮用户输入后、主世界层之前",
      "rationale": "删掉则表补与规则触发放回主世界层，挤占历史上下文",
      "acceptance": "continue"
    },
    {
      "name": "主世界层",
      "ref": "world-simulator",
      "duty": "读投影与真值，输出 settlement.v1 裁决包；可提议变量变更",
      "when": "每轮用户输入后（旁观之后）",
      "rationale": "删掉则无程序化裁决与真值更新",
      "acceptance": "continue"
    },
    {
      "name": "叙事转述",
      "ref": "narrator",
      "duty": "只读裁决包，写用户可见正文",
      "when": "裁决包就绪后",
      "rationale": "删掉则无独立文风呈现（或需 gm 兼写，须用户明确）",
      "acceptance": "review"
    }
  ],
  "resident_context": [
    {
      "id": "experience-contract",
      "position": "static",
      "content": "体验/禁忌压缩句",
      "mount": ["world-simulator", "narrator"]
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
- play_slots auditor+gm+narrator；workers 与槽一致；side_effects 从变量设计拷入。
- 扩写：outline continue + chapter-writer review；无自造 ref。

坏：
- 自由发明 affinity-agent、world-lore-worker。
- 无 play_slots 却塞了 6 个自定义 workers。
- YAML 或半散文
```
