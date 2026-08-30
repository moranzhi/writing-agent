/**
 * 扁平产物契约（wire format）：机器字段薄，正文用 sections[] 字符串块。
 * 渲染与旧 context-fragment.v1 深树通过 normalize 互转。
 */

export const FLAT_ARTIFACT_SCHEMA_ID = "artifact.flat.v1" as const;

export type FlatArtifactQuestion = {
  id: string;
  prompt: string;
  options: string[];
};

export type FlatArtifactSection = {
  id: string;
  title: string;
  text: string;
};

/** 所有需程序校验的创作产物尽量收成此形 */
export type FlatArtifact = {
  schema: typeof FLAT_ARTIFACT_SCHEMA_ID | string;
  skill: string;
  brief: string;
  mount: string[];
  stability: "stable" | "semi" | "volatile" | "";
  sections: FlatArtifactSection[];
  open_questions: string[];
  questions: FlatArtifactQuestion[];
  summary: string;
};

/** OpenAI/DeepSeek strict 友好的 JSON Schema（全 required + additionalProperties:false） */
export const FLAT_ARTIFACT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "skill",
    "brief",
    "mount",
    "stability",
    "sections",
    "open_questions",
    "questions",
    "summary",
  ],
  properties: {
    schema: { type: "string" },
    skill: { type: "string" },
    brief: { type: "string" },
    mount: { type: "array", items: { type: "string" } },
    stability: {
      type: "string",
      enum: ["stable", "semi", "volatile", ""],
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "text"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          text: { type: "string" },
        },
      },
    },
    open_questions: { type: "array", items: { type: "string" } },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "prompt", "options"],
        properties: {
          id: { type: "string" },
          prompt: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
      },
    },
    summary: { type: "string" },
  },
};

export function isFlatArtifact(raw: unknown): raw is FlatArtifact {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const row = raw as Record<string, unknown>;
  return Array.isArray(row.sections);
}

/** 扁形 → 旧 fragment 外壳，便于现有渲染；正文按 section id 堆对象。
 * section.text 若是 JSON 对象/数组字符串，解析回结构，避免专用卡吃到整段 stringify。
 */
export function flatArtifactToFragmentDoc(flat: FlatArtifact): Record<string, unknown> {
  const 正文: Record<string, unknown> = {};
  for (const s of flat.sections) {
    const key = s.id || s.title;
    if (!key) continue;
    正文[key] = coerceSectionText(s.text);
  }
  return {
    schema: "context-fragment.v1",
    技能: flat.skill,
    brief: flat.brief,
    mount: flat.mount,
    ...(flat.stability ? { 稳变: flat.stability } : {}),
    正文,
    开放问题: flat.open_questions,
    追问: {
      导语: "",
      题目: flat.questions.map((q) => ({
        问: q.prompt,
        建议选项: q.options,
      })),
    },
    ...(flat.summary ? { summary: flat.summary } : {}),
  };
}

/** section 文本：纯散文保留；JSON 对象/数组还原为结构 */
export function coerceSectionText(text: string): unknown {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  if (
    !(
      (raw.startsWith("{") && raw.endsWith("}")) ||
      (raw.startsWith("[") && raw.endsWith("]"))
    )
  ) {
    return String(text ?? "");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return String(text ?? "");
  }
}

/** 旧深树 / 任意对象 → 尽量收成扁形（保存与投递归一） */
export function coerceToFlatArtifact(raw: unknown): FlatArtifact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;

  // DAG / worker 集 / 上下文排序：不是扁形正文稿，不能靠 brief 误收
  if (
    Array.isArray(row.steps) ||
    Array.isArray(row.workers) ||
    Array.isArray(row.agents) ||
    Array.isArray(row.slots)
  ) {
    return null;
  }

  if (isFlatArtifact(raw)) {
    return {
      schema:
        typeof row.schema === "string" ? row.schema : FLAT_ARTIFACT_SCHEMA_ID,
      skill: String(row.skill ?? row.技能 ?? ""),
      brief: String(row.brief ?? ""),
      mount: Array.isArray(row.mount)
        ? row.mount.filter((x): x is string => typeof x === "string")
        : [],
      stability:
        row.stability === "stable" ||
        row.stability === "semi" ||
        row.stability === "volatile"
          ? row.stability
          : row.稳变 === "stable" ||
              row.稳变 === "semi" ||
              row.稳变 === "volatile"
            ? row.稳变
            : "",
      sections: (row.sections as FlatArtifactSection[]).map((s) => ({
        id: String(s?.id ?? ""),
        title: String(s?.title ?? ""),
        text: String(s?.text ?? ""),
      })),
      open_questions: Array.isArray(row.open_questions)
        ? row.open_questions.filter((x): x is string => typeof x === "string")
        : Array.isArray(row.开放问题)
          ? row.开放问题.filter((x): x is string => typeof x === "string")
          : [],
      questions: Array.isArray(row.questions)
        ? (row.questions as FlatArtifactQuestion[]).map((q, i) => ({
            id: String(q?.id ?? `q${i + 1}`),
            prompt: String(q?.prompt ?? ""),
            options: Array.isArray(q?.options)
              ? q.options.filter((x): x is string => typeof x === "string")
              : [],
          }))
        : [],
      summary: String(row.summary ?? ""),
    };
  }

  const 正文 = row.正文 ?? row.body;
  const sections: FlatArtifactSection[] = [];
  if (正文 && typeof 正文 === "object" && !Array.isArray(正文)) {
    for (const [key, val] of Object.entries(正文 as Record<string, unknown>)) {
      sections.push({
        id: key,
        title: key,
        text:
          typeof val === "string"
            ? val
            : JSON.stringify(val, null, 2),
      });
    }
  } else if (typeof 正文 === "string" && 正文.trim()) {
    sections.push({ id: "body", title: "正文", text: 正文 });
  }

  const probe = row.追问;
  const questions: FlatArtifactQuestion[] = [];
  if (probe && typeof probe === "object" && !Array.isArray(probe)) {
    const topics = (probe as { 题目?: unknown }).题目;
    if (Array.isArray(topics)) {
      topics.forEach((t, i) => {
        if (!t || typeof t !== "object") return;
        const item = t as Record<string, unknown>;
        questions.push({
          id: `q${i + 1}`,
          prompt: String(item.问 ?? item.prompt ?? ""),
          options: Array.isArray(item.建议选项)
            ? item.建议选项.filter((x): x is string => typeof x === "string")
            : Array.isArray(item.options)
              ? item.options.filter((x): x is string => typeof x === "string")
              : [],
        });
      });
    }
  }

  if (!sections.length) return null;

  const stab = row.稳变 ?? row.stability;
  return {
    schema: FLAT_ARTIFACT_SCHEMA_ID,
    skill: String(row.技能 ?? row.skill ?? ""),
    brief: String(row.brief ?? ""),
    mount: Array.isArray(row.mount)
      ? row.mount.filter((x): x is string => typeof x === "string")
      : [],
    stability:
      stab === "stable" || stab === "semi" || stab === "volatile" ? stab : "",
    sections,
    open_questions: Array.isArray(row.开放问题)
      ? row.开放问题.filter((x): x is string => typeof x === "string")
      : Array.isArray(row.open_questions)
        ? row.open_questions.filter((x): x is string => typeof x === "string")
        : [],
    questions,
    summary: String(row.summary ?? ""),
  };
}
