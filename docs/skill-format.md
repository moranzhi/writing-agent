# Skill 格式与存储

> **文档层级：Skill 包格式（非系统架构）。**  
> 系统级模块与调度边界见 [`architecture.md`](./architecture.md)。  
> **现行唯一落地包**：`skills/dialogue/world-simulator/`（见该包 README、`world-simulator-modules.md`）。  
> 创作流水线：`design-flow` + `design-step`。

本文只写**包怎么落盘、registry、启动时怎么绑包**。manifest 正文见 `orchestrator-skill-format.md`；磁盘 Worker 见 `worker-skill-format.md`；建包步骤见 `skill-design-guide.md`。

---

## 1. 两层 Skill

| 类型 | 路径 | 消费者 | 写什么 |
|------|------|--------|--------|
| **编排器 Skill** | `skills/{bookKind}/{name}/orchestrator.md` | Main Agent | **何时**调哪个 worker、验收方式、启动引导 |
| **Worker Skill** | `workers/{workerId}/SKILL.md` | Worker Agent | **inputTags/outputTags**、怎么做 |

```text
会话开始
  → 自动绑定默认编排器包（world-simulator）
  → UI 选配方（recipes/，不是再选 skill 包）
  → 编排器按 tool loop 调度；Worker 读本包 workers/{id}/SKILL.md
```

**何时评估** = 编排器 Skill。  
**如何评估** = 对应 Worker Skill（或运行规格里的声明）。

---

## 2. 存储位置

Skill 以 **Skill 包** 为单位：一个编排器 + 其专属 workers，**同包绑定，不跨包复用 worker**。

```text
skills/
├── registry.yaml
└── dialogue/
    └── world-simulator/
        ├── orchestrator.md
        ├── recipes/
        ├── modules/
        ├── worker-templates/
        └── workers/
            ├── design-flow/SKILL.md
            ├── design-step/SKILL.md
            └── opening-generator/SKILL.md
```

```text
第一层文件夹 = bookKind（novel | dialogue），决定 Book 存储结构
第二层文件夹 = 一个 skill 包，名与 frontmatter.name 一致
  orchestrator.md   编排器 Skill
  workers/{id}/     本包专属 worker；id 在包内唯一
```

loader 仍扫描 `skills/novel/` 与 `skills/dialogue/`（平铺 `.md` 或 `{name}/orchestrator.md`）。仓库里目前只有 `dialogue/world-simulator`。

**为何不复用 worker：** 同一产出形状在不同编排器下的写法、验收完全不同；需要相似流程时复制后再改。

---

## 3. Frontmatter（编排器）

loader（`src/skills/loader.ts`）从 `orchestrator.md` 解析的字段：

| 字段 | 必需 | 用途 |
|---|---|---|
| `name` | ✅ | skill id |
| `description` | ✅ | 列表展示、匹配 |
| `category` | ✅ | 与 `bookKind` 一致：`novel` \| `dialogue` |
| `bookKind` | 建议 | 缺省时由所在文件夹推断 |
| `workers` | 建议 | 本包可调度的 design worker id（亦认 `suggestedWorkers`） |
| `demandTag` | | 启动写入目标；缺省 `book.brief` |
| `startupMode` | | `agent-first`（默认）或 `intake`（legacy） |
| `uiPrompt` | | agent-first 首屏引导 |
| `tags` | | 体裁细分 |
| `version` | | 数字 |

正文章节、验收与禁用行为见 `orchestrator-skill-format.md`。不要再写「推荐阶段 / 质量评估标准 / 推荐 Worker」那套旧 SKILL 骨架。

---

## 4. registry.yaml

启动时列举可用 skill，不必全靠扫盘：

```yaml
skills:
  - name: world-simulator
    description: 默认包：选配方 → 编排工作流计划 → 执行单元上场
    category: dialogue
    bookKind: dialogue
    path: dialogue/world-simulator/orchestrator.md
```

无 `registry.yaml` 时，Runtime 扫描 `skills/novel/` 与 `skills/dialogue/`。  
registry 列举的是第二层 skill（`name`），不是 category。

---

## 5. 会话启动

新建作品 **不** 让用户输入 skill name。Runtime 加载默认编排器（`world-simulator`，见 `src/config/default-orchestrator.ts`），用户只选**配方**。

```text
idle
  session_started { initialSkill }
    → waiting_user(intake)   # 展示 uiPrompt；用户描述需求
```

`session_started` 携带 `initialSkill` 时跳过 `skill_selection`。  
registry 中其它包仅供 `startWithOrchestrator` / 旧作品读档。

无 `initialSkill` 的旧快照才可能出现 `waiting_user(skill_selection)`。

用户回答写入 `demandTag`（现行包为 `用户.需求`），之后 `design-flow` → `design-step` 编排并收成 worker 集。

---

## 6. 解析与加载

| 文件 | 干嘛的 |
|---|---|
| `src/skills/types.ts` | SkillIndexEntry、ParsedSkill、ParsedWorkerSkill |
| `src/skills/loader.ts` | 读 registry 或扫盘；解析 orchestrator.md 与 workers/*/SKILL.md |
| `src/config/default-orchestrator.ts` | 默认包 id、uiPrompt 兜底 |

完整示例以仓库内真实文件为准：

```text
skills/dialogue/world-simulator/orchestrator.md
skills/dialogue/world-simulator/workers/design-flow/SKILL.md
skills/dialogue/world-simulator/modules/catalog.yaml
skills/dialogue/world-simulator/recipes/catalog.yaml
```

---

## 7. 与其它文档

`creation-playbook.md` 描述创作/游玩流程概念。  
本文件描述包怎么存、启动时怎么绑。  
方法正文见 `design-orchestrator-guide.md`。
