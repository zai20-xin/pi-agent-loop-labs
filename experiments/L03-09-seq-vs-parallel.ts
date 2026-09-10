/**
 * 实验9：顺序执行 vs 并行执行对比
 *
 * 场景：同一个 LLM 返回两个 toolCall，分别用 sequential 和 parallel 模式执行
 *       对比事件顺序的差异
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-course/experiments/experiment-9-seq-vs-parallel.ts
 */

import {
  type AssistantMessage,
  type AssistantMessageEvent,
  EventStream,
  type Message,
  type Model,
  type UserMessage,
} from "../src/pi-ai.ts";
import { Type } from "@sinclair/typebox";
import { agentLoop } from "../src/agent-loop.ts";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
} from "../src/types.ts";

function createUsage() {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createModel(): Model<"openai-responses"> {
  return {
    id: "mock-model", name: "Mock Model", api: "openai-responses",
    provider: "openai", baseUrl: "https://example.invalid",
    reasoning: false, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192, maxTokens: 2048,
  };
}

function createUserMessage(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function createAssistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant", content, api: "openai-responses",
    provider: "openai", model: "mock-model", usage: createUsage(),
    stopReason, timestamp: Date.now(),
  };
}

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected event type");
      },
    );
  }
}

// ========== 两个假工具（模拟不同执行时间） ==========

const slowSchema = Type.Object({ input: Type.String() });
const slowTool: AgentTool<typeof slowSchema> = {
  name: "slowTool",
  label: "慢工具",
  description: "模拟耗时操作",
  parameters: slowSchema,
  async execute(_id, params) {
    console.log(`  [工具] slowTool 开始 (${new Date().toISOString().slice(11, 23)})`);
    await new Promise((r) => setTimeout(r, 100));  // 模拟 100ms 延迟
    console.log(`  [工具] slowTool 结束 (${new Date().toISOString().slice(11, 23)})`);
    return {
      content: [{ type: "text", text: "慢工具完成" }],
      details: null,
    };
  },
};

const fastSchema = Type.Object({ input: Type.String() });
const fastTool: AgentTool<typeof fastSchema> = {
  name: "fastTool",
  label: "快工具",
  description: "模拟快速操作",
  parameters: fastSchema,
  async execute(_id, params) {
    console.log(`  [工具] fastTool 开始 (${new Date().toISOString().slice(11, 23)})`);
    await new Promise((r) => setTimeout(r, 10));  // 模拟 10ms 延迟
    console.log(`  [工具] fastTool 结束 (${new Date().toISOString().slice(11, 23)})`);
    return {
      content: [{ type: "text", text: "快工具完成" }],
      details: null,
    };
  },
};

// ========== 假 LLM ==========

let callCount = 0;

function fakeStreamFn() {
  const stream = new MockAssistantStream();
  queueMicrotask(() => {
    callCount++;
    if (callCount === 1) {
      console.log("[假LLM] 第1次 → 返回2个toolCall");
      const message = createAssistantMessage(
        [
          { type: "toolCall", id: "tc-1", name: "slowTool", arguments: { input: "data1" } },
          { type: "toolCall", id: "tc-2", name: "fastTool", arguments: { input: "data2" } },
        ],
        "toolUse",
      );
      stream.push({ type: "done", reason: "toolUse", message });
    } else {
      console.log("[假LLM] 第2次 → 最终文本");
      const message = createAssistantMessage([{ type: "text", text: "全部完成" }]);
      stream.push({ type: "done", reason: "stop", message });
    }
  });
  return stream;
}

// ========== 运行两次，对比顺序 ==========

async function runOnce(mode: "sequential" | "parallel"): Promise<AgentEvent[]> {
  callCount = 0;
  const context: AgentContext = {
    systemPrompt: "你是一个助手。",
    messages: [],
    tools: [slowTool, fastTool],
  };
  const userPrompt = createUserMessage("执行两个工具");
  const config: AgentLoopConfig = {
    model: createModel(),
    toolExecution: mode,
    convertToLlm: (messages) =>
      messages.filter((m) =>
        m.role === "user" || m.role === "assistant" || m.role === "toolResult",
      ) as Message[],
  };

  const stream = agentLoop([userPrompt], context, config, undefined, fakeStreamFn);
  const events: AgentEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  await stream.result();
  return events;
}

async function main() {
  console.log("=".repeat(60));
  console.log("实验9：顺序执行 vs 并行执行对比");
  console.log("=".repeat(60));

  // 并行模式
  console.log("\n--- 并行模式 (parallel) ---");
  const parallelEvents = await runOnce("parallel");
  parallelEvents.forEach((e, i) => {
    const tag =
      e.type === "tool_execution_start" ? ` ← ${e.toolName}` :
      e.type === "tool_execution_end" ? ` ← isError=${e.isError}` : "";
    console.log(`  ${i + 1}. ${e.type}${tag}`);
  });

  // 顺序模式
  console.log("\n--- 顺序模式 (sequential) ---");
  const sequentialEvents = await runOnce("sequential");
  sequentialEvents.forEach((e, i) => {
    const tag =
      e.type === "tool_execution_start" ? ` ← ${e.toolName}` :
      e.type === "tool_execution_end" ? ` ← isError=${e.isError}` : "";
    console.log(`  ${i + 1}. ${e.type}${tag}`);
  });

  // 对比
  console.log("\n" + "=".repeat(60));
  console.log("对比结果：");
  console.log("=".repeat(60));

  const parallelToolStarts = parallelEvents
    .filter((e) => e.type === "tool_execution_start")
    .map((e) => e.type === "tool_execution_start" ? e.toolName : "");
  const parallelToolEnds = parallelEvents
    .filter((e) => e.type === "tool_execution_end")
    .map((e) => e.type === "tool_execution_end" ? e.toolName : "");

  const sequentialToolStarts = sequentialEvents
    .filter((e) => e.type === "tool_execution_start")
    .map((e) => e.type === "tool_execution_start" ? e.toolName : "");
  const sequentialToolEnds = sequentialEvents
    .filter((e) => e.type === "tool_execution_end")
    .map((e) => e.type === "tool_execution_end" ? e.toolName : "");

  console.log(`\n并行模式：`);
  console.log(`  start 顺序: ${parallelToolStarts.join(" → ")}`);
  console.log(`  end   顺序: ${parallelToolEnds.join(" → ")}`);
  console.log(`  总事件数: ${parallelEvents.length}`);

  console.log(`\n顺序模式：`);
  console.log(`  start 顺序: ${sequentialToolStarts.join(" → ")}`);
  console.log(`  end   顺序: ${sequentialToolEnds.join(" → ")}`);
  console.log(`  总事件数: ${sequentialEvents.length}`);

  console.log("\n结论：");
  console.log("  并行：两个 start 连续发出，end 按完成序（fast 先于 slow）");
  console.log("  顺序：start 和 end 交替出现，严格按 slow → fast 顺序");
  console.log("  顺序模式下，一个工具完全执行完才开始下一个");
}

main().catch(console.error);
