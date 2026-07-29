# Skill 设计指南（包格式薄层）

> **文档层级：Skill 包格式薄层（非系统架构）。**  
> 运行内核见 [`architecture.md`](./architecture.md)；创作方法见下。

**创作方法（三大步、表、自检、正推）** 的权威文档是：

→ **[`design-orchestrator-guide.md`](./design-orchestrator-guide.md)**

本文只保留：**如何在仓库里建包、Worker 集弱结构示例、与旧概念对照**。不要在本文重复长方法文。

格式字段见 `orchestrator-skill-format.md`、`worker-skill-format.md`；上下文见 `context-assembly.md`。

**设计顺序（概念）：**

```text
1. 用户意图 → design-intake（按 design-orchestrator-guide）→ 设计.worker集 JSON
2. 需要时合并 worker-templates 默认契约（仅 design 缺省）
3. 用户验收 → 用户手动进 play
4. play：按声明调度；表维护/副作用边沿触发
```

---

## 0. 设计.worker集

### 0.1 定位

旧 **交互范式 / run_skill 清单 / 美学纲领** 合并为单一 tag：**`设计.worker集`（JSON）**。

| 旧概念 | 新做法 |
|--------|--------|
| `设计.交互范式` | `interaction`（站位、系统扮演、输出与轮转） |
| `设计.run_skill清单` | `workers` + 数据依赖 / 表副作用 |
| `设计.美学纲领` | 转述 presentation **或** 常驻上下文；叙事指南 ≠ 文风 |

Worker 集不是闭集枚举，也不是逐步管道。方法见 `design-orchestrator-guide.md`。

### 0.2 design-intake

与用户对话，增量更新草稿，accept 后即实例规格。进 play **由用户手动决定**。

### 0.3 弱结构示例（JSON）

```json
{
  "version": 1,
  "interaction": {
    "user_stance": "单角代入",
    "system_role": "世界执行并给出可读叙事",
    "output": "输出.用户展示 + 可折叠状态表",
    "turn_shape": "对话回合"
  },
  "experience_check": {
    "user_relation": "…",
    "focus": "…",
    "satisfaction_source": "…"
  },
  "workers": [
    {
      "ref": "world-simulator",
      "duty": "世界推进与裁决",
      "rationale": "删掉则无本轮世界结果",
      "acceptance": "continue"
    },
    {
      "ref": "narrator",
      "duty": "组装用户可见回复",
      "rationale": "核心产出干巴，需要可读终稿",
      "acceptance": "review"
    }
  ],
  "resident_context": [
    {
      "id": "tone",
      "position": "static",
      "content": "文风示例",
      "mount": ["narrator"]
    }
  ],
  "tables": {
    "schemas": [],
    "side_effects": [
      {
        "id": "affinity-romance",
        "field": "好感",
        "op": "gte",
        "value": 60,
        "mode": "once",
        "action": {
          "type": "write_tag",
          "tag": "上下文.角色态度",
          "content": "恋爱模式"
        }
      }
    ]
  },
  "narrative_guide": "",
  "core_premises": [],
  "input_protocol": {
    "parens": "() 元要求",
    "quotes": "\"\" 角色对白",
    "bare": "无包裹视为事实陈述"
  },
  "design_end": {
    "opening": "optional"
  }
}
```

`presentation` 主要挂转述类；裁决类不挂展示美学。包级共性可写 `shared-context.md`。

### 0.4 编辑与重 roll

见 `run-snapshot.md`。  
**创作**：按创作单位验收后删交互留产物。固定上下文相关名称是 **可向用户询问的示例话题**（非填空表）；宜先钉纲领类 tag 再写 worker（挂载复用），见 `design-orchestrator-guide.md` §6。  
**Run** 验收点（`acceptance: review`）：接受后压缩过程 tag。  
`acceptance: continue` 的中间 worker 可连跑；面向用户的可读停点由 Worker 集声明。

---

## 1. 暂停与用户

边界 tool 即暂停（`ask_user`、`review_artifact` 等）。策略写在 manifest **验收策略**，不是「第几步必须停」。  
Play 默认不对每轮终稿强制 accept。详见 `design-orchestrator-guide.md` §0、§7。

---

## 2. 相关

| 文档 | 关系 |
|------|------|
| **design-orchestrator-guide.md** | ★ 方法 |
| creation-playbook.md | 流程概念 |
| orchestrator-skill-format.md | manifest |
| worker-skill-format.md | 磁盘 SKILL（声明驱动演进中） |
