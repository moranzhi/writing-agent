# Skill 包索引

> 用户侧术语：**导演 / 剧本 / 演员 / 能力**（见 `docs/ui-glossary.md` §0）。  
> 系统内核见 `docs/architecture.md`。

当前仅注册 **`world-simulator`**（`registry.yaml`）。

## 结构（一层包）

```text
skills/
  registry.yaml
  dialogue/
    world-simulator/           # 默认 skill 包（内部英文 id）
      orchestrator.md          # 导演调度 manifest
      recipes/                 # 【导演】选项（用户新建时选）
      modules/                 # 【能力】共用工序
      workers/                 # 创作期磁盘演员
        design-flow/
        design-step/
        opening-generator/
      worker-templates/        # 游玩演员默认契约（合并进 Worker 集）
```

## 运行（简）

```text
用户选【导演】
  → design-flow：编排【剧本】增量 DAG（设计.创作流程，可追加/可反复）
  → design-step：逐步执行能力 → … → 设计.worker集
  → （可选）opening-generator
  → 用户手动进 play → 按声明调度【演员】
```

路径 / `run_worker` id **保持英文**；中文只出现在 `name` / `declaration` / 正文。

## 相关

- 作者清单：`docs/world-simulator-modules.md`
- 包内说明：`dialogue/world-simulator/README.md`
- 创作方法长文：`docs/design-orchestrator-guide.md`（部分章节仍写旧分步名，以本包为准）
