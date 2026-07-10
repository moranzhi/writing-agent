# scene-roleplay（TODO）

## 定位

场景扮演 + 角色卡互动（**一个 skill 包**，不拆 author / play）。

```text
instantiate   用户.角色需求、角色.{id}.设定、角色卡.*、世界.规则、用户.控制模式 …
run           用户行动 → 世界裁决 → 角色反应 → 输出.场景反馈 → 状态更新
done          确认稿归档 Book；下一场 Session 可从 Book 加载 instantiate tag
```

## instantiate 预期 tag（草案）

```text
用户.角色需求 | 用户.互动偏好 | 用户.控制模式
角色.{id}.设定 | 角色卡.口吻样例 | 角色卡.行为边界 | 角色卡.确认稿
世界.规则 | 世界.当前状态
场景.当前状态（可选开场）
```

可选 **setup worker** 把用户口语整理为上述 tag（仍是 worker，非第二总管）。

## run 预期 tag（草案）

```text
用户.行动输入 | 用户.行动意图 | 用户.导演指令
场景.可见信息 | 场景.隐藏信息
角色.{id}.记忆 | 信念 | 行动.候选 | 台词.候选 | 反应
行动.裁决结果
输出.场景反馈 | 输出.互动回复
更新.世界状态 | 更新.角色状态
```

## 下一步

- [ ] 写 `orchestrator.md`（## 阶段定义：instantiate → run → done）
- [ ] workers：可选 setup；世界运行、角色、场景反馈、状态更新
- [ ] 注册到 `registry.yaml`

见 `docs/tag-blackboard.md` §2。
