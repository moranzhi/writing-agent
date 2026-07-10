# 预设格式

## 1. 定位

Preset 是一次 LLM 请求的上下文编排资产。它负责描述 prompt manager 中有哪些条目、这些条目的启用状态与排列顺序，以及本次生成使用哪些模型参数。

第一版的 preset 目标是兼容 SillyTavern 类预设文件中的核心部分，而不是完整复刻 SillyTavern 的所有扩展能力。

需要支持的内容：

```text
prompts
  prompt manager 条目列表。每个条目描述一段可插入上下文的 prompt。

prompt_order
  条目顺序与启用关系。它决定本次请求实际按什么顺序装配 prompt。

generation parameters
  生成参数，例如 temperature、top_p、top_k、min_p、frequency_penalty、presence_penalty、max tokens 等。
```

第一版不支持的内容：

```text
regex_scripts
  正则隐藏、正文提取、格式美化等后处理脚本。

extension scripts
  预设内携带的前端脚本、按钮、插件配置。

UI-only fields
  只影响 SillyTavern 界面展示、不影响 LLM 请求组装的字段。
```

## 2. 从 SillyTavern 预设中读取什么

一个真实的 SillyTavern 预设通常同时包含 prompt manager 条目、顺序关系、生成参数和扩展配置。我们的导入器只读取前三类。

### 2.1 Prompt 条目

从 `prompts` 数组读取 prompt manager 条目。

典型字段：

```ts
type ImportedPromptEntry = {
  identifier: string;
  name: string;
  enabled: boolean;
  role: "system" | "user" | "assistant";
  content?: string;
  injection_position?: number;
  injection_depth?: number;
  injection_order?: number;
  system_prompt?: boolean;
  marker?: boolean;
  forbid_overrides?: boolean;
};
```

字段含义：

```text
identifier
  条目唯一标识。prompt_order 通过它引用条目。

name
  给用户看的条目名称。

enabled
  条目自身默认启用状态。最终是否启用还需要结合 prompt_order。

role
  条目插入请求时使用的消息角色。

content
  条目文本。部分内置 marker 条目可能没有 content，需要运行时从 session 或角色数据中补齐。

injection_position / injection_depth / injection_order
  SillyTavern 的插入位置、深度和顺序信息。第一版先保留，不完全模拟深度插入语义。

system_prompt / marker
  标识这个条目是不是内置占位条目，例如角色描述、世界书、聊天历史等。

forbid_overrides
  标识条目是否禁止被覆盖。第一版先保留字段，不实现复杂覆盖策略。
```

### 2.2 顺序与启用关系

从 `prompt_order` 读取实际装配顺序。

典型字段：

```ts
type ImportedPromptOrder = Array<{
  character_id: number;
  order: Array<{
    identifier: string;
    enabled: boolean;
  }>;
}>;
```

第一版采用的规则：

```text
1. 以 prompt_order[0].order 作为主顺序。
2. 按 order 数组顺序遍历 identifier。
3. 找到对应 prompts 条目。
4. 只有 order.enabled 和 prompt.enabled 都为 true 时，条目才参与本轮上下文装配。
5. 如果 prompt_order 引用了不存在的 identifier，导入时记录 warning，但不阻断导入。
6. 如果 prompts 中存在但 prompt_order 未引用，默认不参与请求，但保留在 preset 中。
```

`prompt_order` 比 `prompts` 中的排列更重要。`prompts` 是条目仓库，`prompt_order` 才是实际启用的编排表。

### 2.3 生成参数

从预设顶层读取生成参数。

第一版优先支持这些字段：

```ts
type ImportedGenerationParameters = {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  openai_max_context?: number;
  openai_max_tokens?: number;
  stream_openai?: boolean;
  reasoning_effort?: string;
  verbosity?: string;
  seed?: number;
  n?: number;
};
```

字段分为两类：

```text
通用采样参数
  temperature、top_p、top_k、min_p、frequency_penalty、presence_penalty、repetition_penalty。

请求容量与行为参数
  openai_max_context、openai_max_tokens、stream_openai、reasoning_effort、verbosity、seed、n。
```

不同供应商不一定支持全部字段。导入后应先保存原始字段，再由 LLM adapter 决定哪些字段可以发送。

## 3. 内部归一化格式

导入 SillyTavern preset 后，不应该直接在业务层使用原始 JSON。需要归一化成我们自己的结构。

```ts
type PresetPackage = {
  id: string;
  name: string;
  source: "native" | "sillytavern";
  prompts: PresetPromptEntry[];
  promptOrder: PresetPromptOrderItem[];
  generation: GenerationParameters;
  unsupported: UnsupportedPresetSection[];
  raw?: unknown;
};

type PresetPromptEntry = {
  id: string;
  name: string;
  enabled: boolean;
  role: "system" | "user" | "assistant";
  content: string;
  marker: boolean;
  sourceIdentifier: string;
  injection?: {
    position?: number;
    depth?: number;
    order?: number;
  };
};

type PresetPromptOrderItem = {
  promptId: string;
  enabled: boolean;
  orderIndex: number;
};

type GenerationParameters = {
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  stream?: boolean;
  reasoningEffort?: string;
  verbosity?: string;
  seed?: number;
  variants?: number;
};

type UnsupportedPresetSection = {
  path: string;
  reason: string;
};
```

归一化后的 `PresetPackage` 是系统内部唯一使用的 preset 结构。原始 SillyTavern JSON 只作为导入来源和调试证据保留。

## 4. 上下文装配规则

一次请求的上下文装配按以下顺序执行：

```text
1. 读取 PresetPackage.promptOrder。
2. 过滤 enabled=false 的顺序项。
3. 找到对应 PresetPromptEntry。
4. 再过滤 entry.enabled=false 的条目。
5. 对 marker 条目进行运行时替换。
6. 对普通 content 条目进行变量替换。
7. 按 role 合并成 LLM messages。
8. 应用 generation 参数。
```

其中 marker 条目用于挂载运行时上下文：

```text
charDescription
  可以映射为当前创作项目的设定说明。

charPersonality
  可以映射为文风、叙事人称、角色行为约束。

worldInfoBefore / worldInfoAfter
  可以映射为长期设定、世界观、知识库片段。

scenario
  可以映射为当前创作目标或当前阶段说明。

chatHistory
  可以映射为历史会话、已有正文、用户反馈摘要。
```

这些映射不是 SillyTavern 原义的完整复刻，而是为了兼容预设资产，让它们能服务我们的写作 agent。

## 5. 与创作流程的关系

Preset 不决定创作流程，也不决定验收模式。

```text
Preset
  决定本轮请求如何拼接 prompt、哪些条目启用、使用哪些生成参数。

Execution Flow
  决定阶段顺序、每阶段使用哪个 worker、每阶段采用哪种验收模式。

Worker
  决定某个创作能力如何执行，例如大纲、剧情线、文风、正文草稿。

Runtime Session
  记录当前事实、历史事件、产物和审批结果。
```

因此，同一个 preset 可以用于多个创作流程；同一个创作流程也可以切换不同 preset。二者是正交关系。

## 6. 第一版导入策略

第一版导入器只做保守转换：

```text
保留 prompts。
保留 prompt_order。
保留生成参数。
记录但忽略 regex_scripts。
记录但忽略 extension scripts。
记录未知字段，不丢弃原始 JSON。
```

导入结果应该给用户可读的报告：

```text
导入 prompt 条目数量
启用条目数量
未被 prompt_order 引用的条目数量
缺失 identifier 的 order 项
已读取的生成参数
被忽略的扩展字段
```

这个报告比静默导入更重要。预设文件经常很大，且混有脚本、正则、UI 配置和模型参数，必须让用户知道哪些内容真正进入了我们的运行时。