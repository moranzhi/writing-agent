# world-simulator（规划中）

## 定位

RP 代入式交互小说 · **世界模拟器**：用户扮演固定角色，在预先设定好的世界观里遇见不同的人、不同的事。  
交互范式接近 SillyTavern，但本包专精为 **跑团式世界运转**。

架构见 `docs/architecture.md`、`docs/skill-design-guide.md`、`docs/context-assembly.md`。

## 工程结构

```text
orchestrator.md               manifest：skill 注册表 + 验收 + readiness（待写）
workers/                      各 instantiate / run skill（SKILL.md）
shared-context.md             包级固定上下文上半（待写）
instantiate-orchestrator.md   【遗留】Step1–14 管道草稿；将拆为 workers/ 能力库后废弃主流程地位
```

**不注册到 `registry.yaml`**，直至 run manifest 与 readiness 定稿。

## 实例化（design）

不是固定 1→14 管道。agent 在 design stage：

1. 调 **交互范式** skill → `设计.run_skill清单`
2. 按清单倒推，按需 invoke 其他 instantiate skill（世界蓝图、变量目录、叙事指南…）
3. `declare_instance_ready` → play

原 `instantiate-orchestrator.md` 中的 Step 表可迁移为 **workers/** 下独立 SKILL.md，供 agent 选用。

## 运行（play）

agent tool loop 内 invoke run skill（世界模拟器、转述者、变量管理…），上下文 **上半固定、下半动态**，见 `docs/context-assembly.md`。

## 与 scene-roleplay

`scene-roleplay` 为通用占位；本包是其 **世界层 + 固定 POV + 跑团式流向** 专精版。
