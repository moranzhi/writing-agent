# Worker 规格

> 能力文档。程序只切割下方 **fence 块**；`##` 标题仅供人读。  
> 写法说明：`docs/world-simulator-modules.md`；范例：`aesthetics-interaction`。  
> 可选默认契约见 `worker-templates/`（缺省合并用，非本步全文）。

## meta

```meta
name: Worker 规格
id: worker-spec
artifact: 设计.worker规格
declaration: >
  钉一个游玩期执行单元（职责、读写、挂载）；多演员时可多次调用
when: |
  已能说出「游玩时谁上场做什么」，需要把某一个演员钉成可调度契约时；
  或多演员需分次钉清时（本能力可反复）。
when_not: |
  体验/机制仍混沌，还说不清删掉谁会坏体验时 → 先上游能力。
  已在收成「细化终稿」且只需合并已有规格时 → 交给细化终稿，勿重复问卷。
boundary: |
  本能力：一次（或本步焦点内）钉清一个游玩期执行单元：中文名、ref、职责、何时上场、读写 tag、验收点、为何需要。
  产物写入「设计.worker规格」（可含累积列表）；最终合并进「设计.worker集」由「细化终稿」完成。
  细化终稿：收成完整 Worker 集、表、常驻上下文；本步不假装交终稿。
  拓扑图谱：多演员依赖与数据流总图；本步可写本单元读写，不画全图。
  生成规则 / 叙事指南：规则与态度正文；本步只声明挂载哪些 tag，不重写全文。
```

## opening

```opening
先点名「下一个要钉的演员」（一个即可）：

1. 中文称呼：TA 在游玩里叫什么？（例：世界推进、叙事转述、大纲、章节正文）
2. 职责一句话：删掉 TA 会丢掉哪段体验？
3. 何时上场：每轮？用户点名写章时？某条件触发？

若你已有多个演员想法，先写最核心的一个；其余可再跑本能力。
```

## task

```task
你正在执行剧本中的「Worker 规格」步骤。产物写入「设计.worker规格」。

一次 design-step 以钉清**一个**游玩期执行单元为主；若用户一次抛出多个且关系简单，可写入 `actors` 数组但须逐个写清 rationale，并在 summary 标明本步焦点。

执行顺序：
1. 读依赖产物与体验契约；正推「需要谁」——禁止题材默认演员套餐。
2. 若已有「设计.worker规格」，增量：同 ref 更新；新 ref 追加；不要无故删除用户已验收条目（除非用户要求改）。
3. 为该单元填写：name（中文）、ref（英文 kebab，可与 worker-templates 对齐）、duty、when、rationale、acceptance、context/outputs 建议。
4. acceptance：面向用户的可读终稿倾向 `review`；纯中间裁决/整理倾向 `continue`；吃不准就 ask_user。
5. ref 可参考包内模板（如 narrator、world-simulator、outline、chapter-writer），但必须以本局体验为准，勿强行两端都上。
6. 输出符合 output 的 JSON。

若程序已发出默认问题：禁止重复同一开场。

summary：`Worker 规格 · {中文名} · …`
```

## principles

```principles
1. 删掉检验：说不清「丢掉哪段体验」的演员不要。
2. 正推：体验 → 手段 → 演员；禁止「世界模拟就一定要 world-simulator + narrator」。
3. 写手/分段常见最小集：大纲/细纲（outline）+ 章节正文（chapter-writer）；按需加减。
4. 扮演/世界推进常见：世界裁决 + 叙事转述；能合并则问用户是否合并。
5. name 给人看，ref 给机器；二者成对出现。
6. 本步不写完整表 schema、不写整份 Worker 集终稿。
7. 常驻上下文挂载只点名「需要挂哪些已有产物 tag」，不在本步粘贴长文。
```

## probe

```probe
一轮 1～2 点。

缺验收点：本演员产出是「给用户读的一段」还是「给下一演员的中间结果」？
缺 ref：更接近包内哪个模板职责？（给中文选项，勿逼用户记英文）
多演员纠结：能否合并成一个？合并会损失什么？
写手路径：是否需要「先大纲后正文」两个演员，还是只要分段写手？
```

## output

```output
{
  "brief": "一句话：本步钉的演员如何服务体验",
  "actors": [
    {
      "name": "叙事转述",
      "ref": "narrator",
      "duty": "…",
      "when": "…",
      "rationale": "删掉则…",
      "acceptance": "review",
      "context": {
        "static": ["设计.worker集"],
        "dynamic": ["用户.最新输入"]
      },
      "outputs": ["输出.用户展示"],
      "presentation": {
        "tone": "可选；转述类可填"
      }
    }
  ],
  "增量说明": "相对旧稿新增/改了哪个 ref",
  "开放问题": ["…"]
}
```

`acceptance` 只能是 `review` 或 `continue`。未知字段省略。

## checklist

```checklist
- [ ] 每个演员能否通过删掉检验？
- [ ] name/ref 是否成对？acceptance 是否写出？
- [ ] 是否误交完整 设计.worker集 或表结构？
- [ ] 是否题材默认套演员？
- [ ] 增量是否误删已有条目？
```

## examples

```examples
好：
- 扩写：先钉「大纲/细纲」outline（continue 或 review 按用户是否要验大纲），再另一步钉「章节正文」chapter-writer（review）。
- 扮演：世界推进 continue + 叙事转述 review。

坏：
- 一次甩出 8 个演员且无 rationale
- 只写英文 id 给用户看
- 本步直接输出整份 version:1 Worker 集冒充终稿
```
