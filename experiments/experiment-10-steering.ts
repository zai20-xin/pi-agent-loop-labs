/**
 * 实验10：getSteeringMessages 插话
 *
 * 场景：agent 执行工具期间，用户输入"别删那个文件"
 *       插话不打断已开始的工作，但必然影响下一轮决策
 *
 * 假 LLM 行为：
 *   第1次：调 exec 工具
 *   第2次：看到插话后，调整回复
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-course/experiments/experiment-10-steering.ts
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

// ========== 假工具 ==========

const execSchema = Type.Object({ command: Type.String() });
const execTool: AgentTool<typeof execSchema> = {
  name: "exec",
  label: "执行命令",
  description: "执行 shell 命令",
  parameters: execSchema,
  async execute(_id, params) {
    console.log(`  [工具] exec("${params.command}")`);
    return {
      content: [{ type: "text", text: `执行: ${params.command}` }],
      details: null,
    };
  },
};

// ========== 关键：getSteeringMessages 返回插话 ==========

let callCount = 0;
let steeringRound = 0;  // 记录插话在哪一轮注入

function fakeStreamFn() {
  const stream = new MockAssistantStream();
  queueMicrotask(() => {
    callCount++;
    if (callCount === 1) {
      console.log("[假LLM] 第1次 → 调 exec 工具");
      const message = createAssistantMessage(
        [{ type: "toolCall", id: "tc-1", name: "exec", arguments: { command: "rm -rf /tmp/old" } }],
        "toolUse",
      );
      stream.push({ type: "done", reason: "toolUse", message });
    } else {
      // 第2次：LLM 看到了插话，调整回复
      console.log("[假LLM] 第2次 → 看到插话，回复用户");
      const message = createAssistantMessage([
        { type: "text", text: "好的，我不删那个文件了。" },
      ]);
      stream.push({ type: "done", reason: "stop", message });
    }
  });
  return stream;
}

// ========== 运行 ==========

async function main() {
  console.log("=".repeat(60));
  console.log("实验10：getSteeringMessages 插话");
  console.log("=".repeat(60));
  console.log("场景：agent 执行工具期间，用户说'别删那个文件'");
  console.log("=".repeat(60));

  const context: AgentContext = {
    systemPrompt: "你是一个助手。",
    messages: [],
    tools: [execTool],
  };

  const userPrompt = createUserMessage("帮我清理临时文件");
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: (messages) =>
      messages.filter((m) =>
        m.role === "user" || m.role === "assistant" || m.role === "toolResult",
      ) as Message[],

    // 关键：第一次轮询返回空，第二次轮询返回插话，之后返回空
    getSteeringMessages: async () => {
      steeringRound++;
      if (steeringRound === 1) {
        console.log("  [插话] getSteeringMessages 第1次 → 返回空（工具还在执行）");
        return [];
      }
      if (steeringRound === 2) {
        console.log("  [插话] getSteeringMessages 第2次 → 返回用户插话！");
        return [createUserMessage("别删那个文件！")];
      }
      console.log("  [插话] getSteeringMessages 第${steeringRound}次 → 返回空（已处理过）");
      return [];
    },
  };

  const stream = agentLoop([userPrompt], context, config, undefined, fakeStreamFn);
  const events: AgentEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    const detail =
      event.type === "tool_execution_start" ? ` (${event.toolName})` :
      event.type === "tool_execution_end" ? ` (isError=${event.isError})` : "";
    console.log(`  事件: ${event.type}${detail}`);
  }
  const messages = await stream.result();

  console.log("\n" + "=".repeat(60));
  console.log("结果：");
  console.log("=".repeat(60));
  console.log(`总事件数: ${events.length}`);
  console.log(`总消息数: ${messages.length}`);
  console.log(`LLM 调用次数: ${callCount}`);

  console.log("\n上下文中的消息链：");
  messages.forEach((m, i) => {
    const role = m.role;
    let text = "";
    if (role === "user") {
      text = typeof m.content === "string" ? m.content : "";
    } else if (role === "assistant") {
      const t = m.content.find((c) => c.type === "text");
      text = t && "text" in t ? t.text : "";
    } else if (role === "toolResult") {
      const t = m.content.find((c) => c.type === "text");
      text = t && "text" in t ? t.text : "";
    }
    console.log(`  ${i + 1}. [${role}] "${text}"`);
  });

  console.log("\n结论：");
  console.log("  - 工具照常执行完毕（插话不打断已开始的工作）");
  console.log("  - 工具结果回填后，轮询 getSteeringMessages 取到插话");
  console.log("  - 插话注入上下文，LLM 下一轮看到后调整行为");
  console.log("  - 这就是'插话打断当前工作流，但必然影响下一轮决策'");
}

main().catch(console.error);
