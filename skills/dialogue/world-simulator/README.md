# world-simulator

默认 skill 包。术语与作者清单：`docs/ui-glossary.md` §0、`docs/world-simulator-modules.md`。

## 目录

```text
orchestrator.md                 # 调度 manifest + uiPrompt
recipes/
  catalog.yaml                  # 导演选项列表
  {id}/recipe.yaml              # 单份导演（建议 steps，可调味）
modules/
  catalog.yaml                  # 能力目录（id / 中文名 / declaration / artifact）
  {id}/prompt.md                # 能力正文（design-step 注入）
workers/
  design-flow/SKILL.md          # 编排剧本骨架
  design-step/SKILL.md          # 执行当前能力步
  opening-generator/SKILL.md    # 可选开场白
worker-templates/
  {ref}.yaml                    # 游玩演员默认契约（写入 Worker 集时合并）
```

## 运行

```text
选导演（recipes）→ design-flow → 验收近期 设计.创作流程（status=open）
  → 反复 design-step（注入 modules/{id}/prompt.md）
  → 不够则再 design-flow（可追加 repeatable 新建，或 mode=revise 回头修改）→ closed
  → （可选）opening-generator → 手动进 play
```

旧分步 `design-core` / `design-fixed` / `design-worker` / `design-refine` / `design-common.md` **已移除**，勿再添加。
