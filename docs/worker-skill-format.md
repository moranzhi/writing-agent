# Worker Skill 格式

> **文档层级：Worker / 声明契约格式（非系统架构）。**  
> 上下文编译原则见 [`architecture.md`](./architecture.md)、[`context-assembly.md`](./context-assembly.md)。  
> **现行包落地**见 [`skills/dialogue/world-simulator/README.md`](../skills/dialogue/world-simulator/README.md)。

## 1. 定位（现行：声明驱动）

**默认包 `world-simulator`：**

```text
play 时执行契约 = accept 后的 设计.worker集 某条 workers[]（实例 Worker 声明）
可选模板       = worker-templates/{ref}.yaml（design 缺省合并默认值）
磁盘 SKILL.md  = 仅创作阶段必要 worker（现：design-flow / design-step / opening-generator）
技能正文       = modules/{id}/prompt.md（由 design-step 注入，不是独立 worker）
```

编排器 `run_worker(id)` → Runtime 校验 id ∈ Worker 声明 → 从 **Worker 集条目**（+ 可选模板合并）拼 prompt → 写声明的 `outputs`。

**不要**为每个 play ref 预置 `workers/narrator/SKILL.md`；实例差异写在 Worker 集里。

规格见 `docs/tag-blackboard.md`、`docs/context-assembly.md`、`skills/dialogue/world-simulator/worker-templates/`。

---

## 2. 创作阶段 Worker（磁盘 SKILL.md）

仅包内 **design 专用** worker 用磁盘文件：

```text
skills/dialogue/world-simulator/
├── orchestrator.md
├── modules/{id}/prompt.md     # 能力切片（非 SKILL.md）
├── worker-templates/          # 可选模板，非执行文件
└── workers/
    ├── design-flow/SKILL.md
    ├── design-step/SKILL.md
    └── opening-generator/SKILL.md
```

- 目录名 = worker id。
- 文件名固定 **`SKILL.md`**。

旧 `design-intake` / `design-core` / `design-fixed` / `design-worker` / `design-refine` **已移除**。

---

## 3. Design Worker Frontmatter（示例）

```yaml
---
id: design-step
skill: world-simulator
name: 创作 · 执行能力步
stage: design
inputTags:
  - "用户.需求"
  - "设计.创作流程"
outputTags:
  - "设计.worker集.草稿"
inputMerge: latest
---
```

| 字段 | 用途 |
|------|------|
| `id` | worker id |
| `skill` | 所属包 name |
| `inputTags` / `outputTags` | 黑板读写白名单 |
| `contextSegments` | 可选；上下拼接 |

### 3.1 contextSegments

见 `docs/context-assembly.md`。

---

## 4. 实例声明字段（写入 `设计.worker集`）

`refine` 能力 / design 收口产出的每条 worker：

```yaml
workers:
  - ref: narrator          # 能力库 id；null = gap
    role: transcription
    duty: …
    when: …
    rationale: …
    context:
      static: [设计.worker集]
      dynamic: [运行.本轮.裁决]
    outputs: [输出.用户展示]
    presentation:
      tone: …
```

未写全的 `context`/`outputs` 可由 `worker-templates/{ref}.yaml` 合并。

---

## 5. 执行要点

- Agent **不**指定 inputTags；读 Worker 声明 / 模板。
- `ref: null` + `gap`：声明了职责但无模板 / SKILL，需补声明或 temp worker。
- 验收：design-flow / design-step 默认需用户确认；play 中间 worker 可 `no_confirmation`。

## 相关

| 文档 | 关系 |
|------|------|
| `creation-playbook.md` | 创作流 |
| `world-simulator-modules.md` | 能力 / 编排器清单 |
| `worker-declaration.ts` | Runtime 声明校验 |
| `worker-templates/README.md` | 可选模板 |
