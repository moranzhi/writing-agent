#!/usr/bin/env node
/**
 * Skill 流程 + 总管 LLM 演示 CLI
 *
 * npm run dev          # 真实 LLM（需 OPENAI_API_KEY）
 * npm run demo         # Mock LLM
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadLlmConfigOptional } from "../config/env.js";
import {
  createMockMainAgentResponse,
  MockLlmProvider,
} from "../llm/client.js";
import { createDefaultMainAgentLlm } from "../runtime/llm-factory.js";
import { formatSession, PhaseRuntime } from "../runtime/phase-runtime.js";

const useMock = process.argv.includes("--mock");

function printSession(runtime: PhaseRuntime): void {
  console.log("\n--- 会话 ---");
  console.log(formatSession(runtime.getSession()));
  const index = runtime.getBlackboard().listTagIndex();
  if (index.length > 0) {
    console.log("blackboard tags:");
    for (const entry of index) {
      console.log(`  - ${entry.tag} [${entry.source}]`);
    }
  }
  console.log("----------------\n");
}

function printHelp(): void {
  console.log(`命令:
  <文本>       选 skill / 提交输入 / 驳回时发修改意见
  /approve     确认总管建议的 worker
  /accept      接受当前产物
  /reject-art  拒绝当前产物
  /status      查看状态
  /quit        退出`);
}

async function main(): Promise<void> {
  const llm = useMock
    ? new MockLlmProvider([
        createMockMainAgentResponse({
          action: "run_worker",
          reason: "建议生成大纲",
          workerId: "outline-worker",
          requiresApproval: true,
        }),
        createMockMainAgentResponse({
          action: "finish",
          reason: "完成",
          requiresApproval: false,
        }),
      ])
    : loadLlmConfigOptional()
      ? createDefaultMainAgentLlm()
      : null;

  if (!llm) {
    console.error("请设置 OPENAI_API_KEY 或使用 --mock");
    process.exit(1);
  }

  if (useMock || !loadLlmConfigOptional()) {
    console.log("使用 Mock LLM\n");
  }

  const runtime = new PhaseRuntime({
    autoStubWorker: true,
    llm,
    onMessage: (msg) => console.log(msg),
  });

  await runtime.start();
  printSession(runtime);
  printHelp();

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const line = (await rl.question("> ")).trim();
      if (!line) continue;

      if (line === "/quit") break;
      if (line === "/help") {
        printHelp();
        continue;
      }
      if (line === "/status") {
        printSession(runtime);
        continue;
      }
      if (line === "/approve") {
        await runtime.approve();
        printSession(runtime);
        continue;
      }
      if (line === "/accept") {
        await runtime.acceptArtifact();
        printSession(runtime);
        continue;
      }
      if (line === "/reject-art") {
        await runtime.rejectArtifact("用户拒绝产物");
        printSession(runtime);
        continue;
      }

      const reason = runtime.getSession().waitingReason;
      if (reason?.kind === "approve_step") {
        await runtime.rejectStep(line);
      } else {
        await runtime.submitInput(line);
      }
      printSession(runtime);

      if (runtime.getSession().phase === "done") {
        console.log("流程已完成。");
        break;
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
