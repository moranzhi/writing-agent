#!/usr/bin/env node
/**
 * 阶段机 + Skill 演示 CLI（不依赖 LLM）
 *
 * 运行：npm run phase-demo
 *       npm run phase-script
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createDecision,
  formatSession,
  PhaseRuntime,
  runMinimalClosedLoop,
} from "../runtime/phase-runtime.js";
import { getAllowedEvents } from "../runtime/phase-machine.js";

const autoStub = process.argv.includes("--auto");
const runScript = process.argv.includes("--script");

function printHelp(): void {
  console.log(`阶段机 + Skill 演示

启动流程：
  1. /start → 列出 skills/ 下的 SKILL.md
  2. 输入 skill name 或编号（如 basic 或 1）
  3. 按 SKILL.md「启动询问」回答
  4. /decide worker outline-worker approve → /approve → …

命令：
  /start              开始会话
  /skills             列出可用 skill
  /status             当前 phase
  /decide ...         模拟总管决策（见下）
  /approve /accept    用户确认
  /worker-start       手动启动 worker
  /worker-done        worker 完成
  /quit

/decide 子命令：
  /decide worker <id> [approve]
  /decide finish [理由]

加 --auto 时 worker 自动占位完成。`);
}

async function main(): Promise<void> {
  const runtime = new PhaseRuntime({
    autoStubWorker: autoStub || runScript,
    onMessage: (msg) => console.log(msg),
  });

  if (runScript) {
    const session = await runMinimalClosedLoop(runtime);
    console.log(formatSession(session));
    console.log(session.phase === "done" ? "✓ 闭环完成" : "✗ 未完成");
    process.exit(session.phase === "done" ? 0 : 1);
  }

  console.log("阶段机 + Skill 演示\n");
  printHelp();

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const line = (await rl.question("> ")).trim();
      if (!line) continue;

      try {
        if (line === "/quit") break;
        if (line === "/help") {
          printHelp();
          continue;
        }
        if (line === "/start") {
          await runtime.start();
          console.log(formatSession(runtime.getSession()));
          continue;
        }
        if (line === "/skills") {
          for (const [i, s] of runtime.getAvailableSkills().entries()) {
            console.log(`  ${i + 1}. ${s.name} — ${s.description}`);
          }
          continue;
        }
        if (line === "/status") {
          console.log(formatSession(runtime.getSession()));
          if (runtime.getActiveSkill()) {
            console.log("activeSkill:", runtime.getActiveSkill()?.name);
          }
          continue;
        }
        if (line === "/events") {
          console.log(getAllowedEvents(runtime.getSession()).join(", "));
          continue;
        }
        if (line === "/approve") {
          await runtime.approve();
          console.log(formatSession(runtime.getSession()));
          continue;
        }
        if (line === "/accept") {
          await runtime.acceptArtifact();
          console.log(formatSession(runtime.getSession()));
          continue;
        }
        if (line === "/worker-start") {
          await runtime.startPendingWorker();
          console.log(formatSession(runtime.getSession()));
          continue;
        }
        if (line === "/worker-done") {
          await runtime.workerComplete();
          console.log(formatSession(runtime.getSession()));
          continue;
        }
        if (line.startsWith("/decide ")) {
          await handleDecide(runtime, line.slice("/decide ".length));
          console.log(formatSession(runtime.getSession()));
          continue;
        }

        await runtime.submitInput(line);
        console.log(formatSession(runtime.getSession()));

        if (runtime.getSession().phase === "done") {
          console.log("流程已完成。");
          break;
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
      }
    }
  } finally {
    rl.close();
  }
}

async function handleDecide(runtime: PhaseRuntime, args: string): Promise<void> {
  const parts = args.split(" ");
  if (parts[0] === "finish") {
    await runtime.submitDecision(
      createDecision({
        action: "finish",
        reason: parts.slice(1).join(" ") || "完成",
        requiresApproval: false,
      }),
    );
    return;
  }
  if (parts[0] === "worker") {
    const workerId = parts[1];
    if (!workerId) throw new Error("用法: /decide worker <id> [approve]");
    await runtime.submitDecision(
      createDecision({
        action: "run_worker",
        reason: `调度 ${workerId}`,
        workerId,
        requiresApproval: parts[2] === "approve",
      }),
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
