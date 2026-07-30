# 细化终稿

> 能力文档。程序只切割下方 **fence 块**；`##` 标题仅供人读。  
> 写法说明：`docs/world-simulator-modules.md`；规格字段见 `docs/skill-design-guide.md`。  
> 本步产物 tag 为 **`设计.worker集`**（可进游玩的实例规格）。

## meta

```meta
name: 细化终稿
id: refine
artifact: 设计.worker集
declaration: >
  钉死关键前提、表与副作用，收成可进游玩的规格
when: |
  前面能力已大致谈清（至少有体验契约，且演员职责可说清），
  需要收成可进游玩的「设计.worker集」JSON 时；
  编排应将本局流程 status 导向 closed。
when_not: |
  体验站位未定、或关键演员仍完全空白时，不要用本步代替上游。
  用户只想改某一个演员细节 → 可先 Worker 规格，再本步合并。
boundary: |
  本能力：合并上游产物，钉死不能瞎发挥的前提，输出完整「设计.worker集」JSON（含 interaction、workers、resident_context、tables 等）。
  进 play 由用户手动决定；本步不自动切游玩。
  Worker 规格：分步钉演员；本步负责合并与终稿一致性。
  美学纲领与交互范式等：只读引用，不重做问卷（矛盾处才问）。
  开局·开场白：可选后续步骤，本步可用 design_end.opening 标记是否建议。
```

## opening

```opening
准备收成可进游玩的规格。请确认或补充：

1. 还有没有「绝不能瞎发挥」的前提要钉死？（一句一条）
2. 游玩时最少需要哪些演员上场？（用中文名即可）
3. 要不要表/状态栏？（不要就写「不要」）

若前面产物已经够用，可直接回复「按已有产物收成」。
```

## task

```task
你正在执行剧本中的「细化终稿」步骤。产物必须写入 **设计.worker集**，且为 **JSON**（不要 YAML）。

本步是收成，不是再开一场题材发明。优先合并：
- 设计.美学纲领与交互范式 → interaction / experience_check / 呈现
- 设计.worker规格 → workers[]
- 设计.叙事指南 / 生成规则 / 具体实例 / 世界蓝图 / 实现机制等 → resident_context 挂载或 core_premises
- 设计.变量* / 状态栏 / 拓扑 → tables / 显隐说明（有则写，无则省略）

执行顺序：
1. 忠实复述已确认的站位、体验内核、禁忌；矛盾处 askUser 1 点，勿静默覆盖。
2. 组装 workers[]：每个含 ref、name（中文）、duty、rationale、acceptance；缺省 context/outputs 可标示留给模板合并，但 acceptance 必须写出。
3. resident_context：把稳定长文（叙事态度、关键规则摘要、禁忌）挂到需要的 workers；不要把全过程聊天塞进去。
4. tables：仅钉体验真正依赖的字段与副作用；无则 `tables` 省略或空 schemas。
5. core_premises：不能瞎发挥的短列表。
6. design_end：如 `{ "opening": "optional" }` 表示可随后跑开场白。
7. 输出完整 JSON；summary：`细化终稿 · Worker集 · N 演员 · …`

若程序已发出默认问题：禁止重复同一开场。

进游玩不在本步完成；用户验收本产物后，由用户手动进入游玩。
```

## principles

```principles
1. 合并优于重写：上游已验收内容优先进入规格，禁止无故改写体验内核。
2. 每个面向用户的可读终稿点必须有 acceptance（review）；中间层 continue。
3. 正推缩减：能不建表就不建；能常驻一段话解决的不要新演员。
4. 写手路径最小可运行：outline + chapter-writer（或用户只要分段写手）；扮演路径按已钉演员。
5. 键名稳定：workers[].ref 英文 kebab；name 中文给人看。
6. 禁止题材固定套件；禁止在本步发明新 tool。
7. 未决进 open_questions，不要假完备。
```

## probe

```probe
一轮 1～2 点，只问会挡住收成的矛盾：

- 上游演员列表与用户本轮说法冲突时，以谁为准？
- 终稿演员是「每轮世界+叙事」还是「先纲后章」？
- 有表需求但字段未定：先不要表，还是先钉 1～2 个关键字段？

能按已有产物收成则不要为「完美」继续盘问。
```

## output

```output
{
  "version": 1,
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
  "workers": [
    {
      "name": "章节正文",
      "ref": "chapter-writer",
      "duty": "…",
      "when": "…",
      "rationale": "删掉则…",
      "acceptance": "review",
      "context": {
        "static": ["设计.worker集", "大纲.当前"],
        "dynamic": ["用户.最新输入"]
      },
      "outputs": ["正文.当前段", "正文.已完成"]
    }
  ],
  "resident_context": [
    {
      "id": "experience-contract",
      "position": "static",
      "content": "从上游压缩的稳定句（体验/禁忌/态度）",
      "mount": ["chapter-writer"]
    }
  ],
  "tables": {
    "schemas": [],
    "side_effects": []
  },
  "core_premises": ["…"],
  "narrative_guide": "可选短摘要；长文优先走 resident_context",
  "input_protocol": {
    "parens": "() 元要求",
    "quotes": "\"\" 角色对白",
    "bare": "无包裹按站位解释"
  },
  "design_end": {
    "opening": "optional"
  },
  "open_questions": ["…"]
}
```

必须是可解析 JSON。无表可省略 tables 或留空数组。每个 workers[] 元素必须有 acceptance。

## checklist

```checklist
- [ ] 是否 JSON 且可解析为设计.worker集？
- [ ] interaction 站位/轮转是否与美学纲领一致？
- [ ] 每个 worker 是否有 name、ref、duty、rationale、acceptance？
- [ ] 删掉任一 worker 的 rationale 是否说得清？
- [ ] 有没有把聊天过程塞进常驻上下文？
- [ ] 有没有题材默认灌入用户未要的演员/表？
- [ ] 验收复述能否一句话说清：站位、体验核心、演员、为何没有某件？
```

## examples

```examples
好：
- 扩写：interaction.turn_shape=助手分段；workers=outline(continue/review)+chapter-writer(review)；resident 挂爽点与禁忌。
- 扮演：world-simulator(continue)+narrator(review)；core_premises 含变造点。

坏：
- 输出 YAML 或半散文
- workers 无 acceptance
- 无视上游，按「标准世界模拟套件」重写
```
