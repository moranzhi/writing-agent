# Skill 设计指南

指导 **如何从零设计一个 orchestrator 包**（skill 能力库 + run skill 组合）。  
格式见 `skill-format.md`、`orchestrator-skill-format.md`、`worker-skill-format.md`；上下文见 `context-assembly.md`。

**设计顺序：**

```text
1. 用户意图 → run skill 清单（交互范式 skill 产出）
2. 每个 run skill 倒推需要哪些 instantiate skill / tag
3. 定义各 skill 的 inputTags、outputTags、contextSegments
4. 上下文隔离与验收边界
5. orchestrator manifest（能力注册，非逐步剧本）
```

---

## 1. 实例化：agent 选 skill，不是填步骤

### 1.1 两层倒推

```text
用户意图（长篇 / 短篇 / 思想实验 / 角色卡扮演 …）
  → 交互范式 skill：产出 设计.run_skill清单
  → 每个 run skill 需要什么输入？
  → agent 按需 invoke instantiate skill（能力库中的 SKILL.md）
  → declare_instance_ready → play stage
```

**能力库**（如 world-simulator 包内十几个 instantiate skill）不是 1→N 管道；agent 跳过不需要的 skill，并记录 `设计.跳过.{skillId}`。

### 1.2 示例：不同意图的 run skill 组合

| 用户意图 | run skill 示例 | 实例化倒推 |
|----------|----------------|------------|
| 长篇小说 | 变量管理、大纲推荐、转述者、世界机 | 变量目录 skill、叙事指南、世界蓝图… |
| 短篇 | 情感流生成器 | 美学纲领、情感曲线约定 |
| 思想实验 | 世界模拟器 | 规则、行动格式；**无**转述者 |
| 角色卡扮演 | 转述者（+ 可选世界机） | 角色卡确认稿、口吻、回复格式 |

### 1.3 run 阶段交互形态

agent 在 play stage 的 burst 内调度 run skill，形态因包而异：

| 形态 | 适用 | sketch |
|------|------|--------|
| 单 skill 直出 | 简单大纲 | `outline` |
| 行动–反应循环 | 博弈、世界模拟 | 世界机 ↔ 角色决策 ↔ 展示 |
| 分叉验收 | 规则怪谈 | `write` → 双 `review` |

形态写在各 skill 的 **能力说明**里，**不**写进全局编排表逐步剧本。

---

## 2. 暂停与用户

### 2.1 边界 tool 即暂停

agent tool loop 在下列情况 **退出 burst**，进入 `waiting_user`：

```text
ask_user / review_blackboard
run_worker + requiresApproval
worker 完成 + user_confirmed → review_artifact
worker ask_user → worker_questions
```

暂停策略写在 orchestrator manifest 的 **验收策略**，不是「第几步必须停」的管道表。

### 2.2 user-turn

用户亲自决策的环节：独立 skill，`用户.最新输入` 写入与 LLM 角色同形 tag，供世界机裁决。见 `worker-skill-format.md`。

---

## 3. 上下文：上半固定、下半动态

每个 skill（`SKILL.md`）声明：

```text
inputTags / outputTags     黑板接口
contextSegments            static（上）+ dynamic（下）
contextIsolation           谁看不见什么
contextProfile variants    实例化时选档位
```

原则：**稳定在上、增量在下**；Runtime 拼接，agent 不改。  
全文见 `docs/context-assembly.md`。

### 3.1 分层示例（roleplay-game-theory）

| tier | 含义 | tag 示例 |
|------|------|----------|
| static | 前提、实体设定 | `情境.实验.设定`、`角色.{id}.设定` |
| dynamic | 历史、本轮 | `运行.事件流`、`可见信息` |

---

## 4. 倒推标签

对每个 skill 填表：

```text
skill id | 职责 | stage(design/play) | inputTags | outputTags | contextSegments | 验收者
```

### 4.1 角色扮演博弈（摘录）

| skill | 读取 | 写入 | 验收 |
|-------|------|------|------|
| setup-scenario | `用户.博弈需求` | 情境、规则、角色设定 | 用户 |
| world-engine | 情境、规则、事件流、行动 | 可见信息、事件流 | 程序 |
| role-decide | 本人设定、事件流、可见信息 | `.思考`、`.行动` | 程序 |
| present-round | 本轮产物 | `输出.用户展示` | 用户 |

展示类 skill 单独存在；agent 调度，不拼长文。

---

## 5. 上下文隔离（必查）

```text
□ 哪些 tag 只给用户、不注入生产 skill？
□ 盲读 review 不可见哪些 tag？
□ 草稿 vs 确认稿：下游何时可当作事实？
□ 多角色：role_pov 是否生效？
```

靠 `inputTags` + `contextIsolation` + Runtime 过滤，不靠 prompt 口头禁止。

---

## 6. orchestrator manifest（非编排表）

orchestrator.md 应包含：

```text
□ 启动询问（最小 intake）
□ instantiate skill 注册表（id、stage、description）
□ run skill 注册表
□ 验收策略（哪些 skill 产出需 user_confirmed）
□ contextProfile 可选 variant 说明
□ declare_instance_ready 最低可行性（按 run_skill清单 动态校验）
```

**不应包含：** 逐步思维链、「第 5 步必须跑 world-engine」类管道脚本。

---

## 7. checklist

```text
□ 1. 一句话：本包 play stage 的交互形态
□ 2. 交互范式 skill 产出 run_skill清单 的 schema
□ 3. 每个 run skill 倒推 instantiate skill 需求
□ 4. 各 SKILL.md：input/output、contextSegments、隔离
□ 5. shared-context.md（static 上半）
□ 6. manifest：注册表 + 验收 + readiness
□ 7. skills/README.md 注册
```

---

## 8. 示例包

| 包 | 特点 |
|----|------|
| `basic` | 单 run skill，最小上下文 |
| `weird-rules-short` | 分叉验收 |
| `roleplay-game-theory` | 行动–反应循环 |
| `world-simulator`（规划） | 大能力库 + agent 实例化 |

对照时复用 **方法**，不照搬 tag 名或 skill 数量。

---

## 9. 相关文档

| 文档 | 关系 |
|------|------|
| `context-assembly.md` | 拼接规格 |
| `creation-playbook.md` | 概念 |
| `orchestrator-skill-format.md` | manifest 写法 |
| `book-storage.md` | 过程与资产归档 |
