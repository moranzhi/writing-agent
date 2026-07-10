# 整体架构

## 1. 方向

**标签驱动黑板** + **agent tool loop** + **5 相位阶段机** + **skill 能力库**。

```text
Skill 包（orchestrator manifest + workers/*/SKILL.md）  静态能力定义
Session + 黑板 tag                                     一次运行的实参
Book                                                     跨 Session 的项目与资产

Agent（总管）   running 相位内 tool loop，调度 invoke 哪个 skill
Runtime         拼接上下文、校验 tool、写黑板、驱动阶段机边界
阶段机          谁可动、何时等用户、产物生命周期——不是流水线剧本
```

核心文档：

```text
docs/tag-blackboard.md          黑板、标签、分工
docs/context-assembly.md        ★ 上下文拼接（上半固定、下半动态）
docs/tool-contracts.md          总管 / worker tool
docs/runtime-state-machine.md   5 相位、tool 边界
docs/book-storage.md            长期存储（过程 / 资产 / 游玩）
docs/skill-design-guide.md      新 skill 包设计方法
docs/implementation-guide.md    代码文件职责
```

---

## 2. 术语

| 词 | 含义 |
|----|------|
| **skill** | `SKILL.md` 定义的能力（设计期能力库中的一条） |
| **worker** | 某 skill 被 invoke 的一次执行 |
| **stage** | 业务阶段：`design`（实例化）→ `play`（运行）→ `done` |
| **phase** | 运行相位：`idle` \| `running` \| `waiting_user` \| `done` \| `error` |

不使用 **step** 指代设计步骤编号，避免与管道混淆。

---

## 3. Agent tool loop

```text
用户硬事件（输入 / 确认 / 验收）
  → phase = running，toolLoopBurst 计数归零
  → while running && burst < N:
        LLM(messages, tools)
        → 循环 tool（read_blackboard …）→ 结果 append 到 messages
        → 边界 tool（run_worker / ask_user / finish）→ 退出 burst
  → 若需用户 → waiting_user
```

- **burst 上限 N**：两次用户操作之间的最大推理轮数，非 Session 终身额度。  
- **循环 tool**：不改 phase，只追加 agent 对话。  
- **边界 tool**：触发阶段机转移（等用户、跑 worker、结束）。

代码：`src/main-agent/tool-loop.ts`、`src/runtime/phase-runtime.ts`。

目标态：worker 执行也用 tool loop（`submit` / `ask_user`），上下文仍由 Runtime 拼接，见 `docs/tool-contracts.md`。

---

## 4. 阶段机做什么

阶段机 **不是** 编排表执行器，而是：

```text
1. Actor 门禁     此刻用户 / agent / worker 谁在场
2. Tool 边界      当前态允许哪些 tool
3. 事实生命周期   draft → accepted；用户才能 accept
4. 等待原因       waitingReason 细分等什么
```

业务「先跑哪个 skill」由 **agent 在 tool loop 里决定**，不由 orchestrator 逐步剧本写死。

---

## 5. 实例化：skill 能力库

实例化 = agent 在 `design` stage 按需 invoke **instantiate skill**（原「设计步骤」），不是固定 1→14 管道。

```text
交互范式 skill → 产出 设计.run_skill清单（run 阶段需要哪些 skill）
每个 run skill 倒推 → 缺什么 instantiate skill → agent invoke
declare_instance_ready → 进入 play stage
```

orchestrator.md = **manifest**（有哪些 skill、约束、验收策略），不是逐步思维链。

---

## 6. 上下文拼接

**上半固定、下半动态**。规则在 skill 定义 + 实例 contextProfile；Runtime 执行。  
见 `docs/context-assembly.md`。

---

## 7. 模块

```text
phase-machine.ts       纯函数：event → phase（边界规则）
phase-runtime.ts       Session IO、tool loop 驱动、worker 执行
main-agent/            tool loop、tool 定义
worker/executor.ts     assembleWorkerContext、run skill
blackboard.ts          tag 池
skills/loader.ts       解析 orchestrator + SKILL.md
book/                  Book、快照、持久化
```

---

## 8. 数据流（目标态）

```text
选 orchestrator 包
  → design：agent burst → invoke instantiate skills → 设计.* tag
  → declare ready → play
  → play：用户输入 → agent burst → invoke run skills → 运行.* tag
  → 过程/资产/游玩 归档 Book（见 book-storage.md）
```

---

## 9. 边界

```text
Agent        调度 skill；read_blackboard；不传 inputTags；不写黑板（边界 tool 除外）
Runtime      拼接上下文；校验 tool；写黑板；执行 worker
Worker LLM   在拼接后的 prompt 内产出；submit 写 declared outputTags
用户         approve、accept、输入
阶段机       只响应 event，不调 LLM
```

---

## 10. 实现进度（摘要）

```text
✅ phase-machine、phase-runtime、skills loader
✅ 总管 tool loop（read_blackboard、run_worker、…）
⬜ toolLoopBurst 按用户事件归零
⬜ assembleWorkerContext（contextSegments）
⬜ worker tool loop
⬜ Book：designTrace / CardAsset / PlayBook
⬜ orchestrator 从编排表迁为 manifest
```
