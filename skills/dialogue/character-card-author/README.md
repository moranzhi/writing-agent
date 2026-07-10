# character-card-author（已合并概念）

**不再作为独立 skill 包。**

角色卡撰写 = **实例化（instantiate）阶段** 的一种产出形态：在扮演类 skill（规划中的 `scene-roleplay`）里，通过启动询问或 setup worker 写入 tag，例如：

```text
用户.角色需求 | 用户.互动偏好
角色.A.设定 | 角色卡.口吻样例 | 角色卡.行为边界
角色卡.确认稿
```

跨 Session 复用角色 → 从 **Book** 加载已有 tag，不必再跑完整实例化。

见 `docs/tag-blackboard.md` §2.6、`skills/README.md`。
