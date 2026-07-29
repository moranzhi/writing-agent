# 标签驱动黑板

## 1. 定位

多 worker 协作式文本生成；**默认能力库包名 = `world-simulator`**（创作方法见 `design-orchestrator-guide.md`，不以「世界模拟」为默认总形态）。

```text
黑板 = 标签化数据池
标签 = worker 之间的接口
设计.worker集 JSON / 声明 = 读哪些 tag、写哪些 tag、表与常驻上下文
Agent = tool loop 内调度 invoke 哪个 id
Runtime = 按声明拼接上下文；表字段 rev 合并
```

## 2. Skill 包、Worker 声明与 Book

```text
Skill 包                         能力库 + design-intake + 可选 templates
设计.worker集（accepted，JSON）  本实例 Worker 声明（play 权威）
Session + 黑板                   一次运行的实参
Book                             过程、存档、资产（book-storage.md）
```

### 业务 stage

```text
design（创作：核心→细节交互→细化）→ 用户验收 → 用户手动进 play → done
运行相位：idle | running | waiting_user | done | error
```

创作方法权威：`design-orchestrator-guide.md`。

### 创作

`design-intake` → accept **`设计.worker集` JSON** → 用户手动进 play（可选开局 · 开场白，非强制锁定）。
无独立 instantiate 管道。见 `design-orchestrator-guide.md`。

### Play

Agent 只能 `run_worker` **声明中的 ref**；执行契约来自 Worker 集条目（可选合并 `worker-templates/`）。

---

## 3. 核心 tag（world-simulator）

```text
用户.需求 / 用户.最新输入 / 用户.修订说明
设计.worker集 / 设计.worker集.草稿
创作.当前单位 / 创作.已验收单位 / 创作.已验收内容 / 创作.对话
运行.初始变量 / 运行.事件流 / 运行.本轮.*
变量.当前
输出.用户展示 / 输出.开场白
```

固定上下文（叙事指南、美学纲领等）在实例规格里落地，play 时经 `resident_context.mount` / `contextSegments` **挂到多个 worker**——这是 tag 化的主收益，不是省掉创作期依赖正文。

命名与创作单位 id 见 `design-orchestrator-guide.md` §6、`ui-glossary.md`；词表可另补 `docs/tag-vocabulary.md`。

---

## 4. 相关

| 文档 | 关系 |
|------|------|
| `creation-playbook.md` | 创作 / 游玩流 |
| `worker-skill-format.md` | 声明驱动 |
| `context-assembly.md` | 上下文拼接 |
| `run-snapshot.md` | 存档 |
