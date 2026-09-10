/**
 * 实验7：agentLoopContinue 续跑
 *
 * 场景：模拟"重试"——上下文已有消息，不加新 prompt 直接续跑
 *
 * 前置条件：
 *   - context.messages 非空
 *   - 最后一条消息不能是 assistant（否则 LLM API 会拒绝）
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-agent-loop-labs/experiments/L03/L03-07-loop-continue.ts
 */

import {
  type AssistantMessage,
  type AssistantMessageEvent,
  EventStream,
  type Message,
  type Model,
  type UserMessage,
  type ToolResultMessage,
} from "../src/pi-ai.ts";
import { Type } from "@sinclair/typebox";
import { agentLoopContinue } from "../src/agent-loop.ts";
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

function createToolResultMessage(toolCallId: string, toolName: string, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
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

const retrySchema = Type.Object({ attempt: Type.Number() });
const retryTool: AgentTool<typeof retrySchema> = {
  name: "retryAction",
  label: "重试操作",
  description: "模拟一个需要重试的操作",
  parameters: retrySchema,
  async execute(_id, params) {
    console.log(`  [工具] retryAction(attempt=${params.attempt})`);
    return {
      content: [{ type: "text", text: `第${params.attempt}次尝试成功` }],
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
    console.log(`[假LLM] 第${callCount}次被调用`);
    const message = createAssistantMessage([
      { type: "text", text: `重试完成（第${callCount}次调用）` },
    ]);
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}

// ========== 运行 ==========

async function main() {
  console.log("=".repeat(60));
  console.log("实验7：agentLoopContinue 续跑");
  console.log("=".repeat(60));

  // 模拟一个已有历史的上下文（最后一条是 toolResult，不是 assistant）
  const context: AgentContext = {
    systemPrompt: "你是一个助手。",
    messages: [
      { role: "user", content: "帮我重试一下", timestamp: Date.now() } as UserMessage,
      createAssistantMessage(
        [{ type: "toolCall", id: "tc-1", name: "retryAction", arguments: { attempt: 1 } }],
        "toolUse",
      ),
      createToolResultMessage("tc-1", "retryAction", "第1次尝试失败"),
    ],
    tools: [retryTool],
  };

  console.log("初始上下文：");
  context.messages.forEach((m, i) => {
    console.log(`  ${i + 1}. [${m.role}] ${m.role === "user" ? m.content : "..."}`);
  });
  console.log("");

  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: (messages) =>
      messages.filter((m) =>
        m.role === "user" || m.role === "assistant" || m.role === "toolResult",
      ) as Message[],
  };

  // 使用 agentLoopContinue（不加新消息，直接续跑）
  console.log("调用 agentLoopContinue...");
  const stream = agentLoopContinue(context, config, undefined, fakeStreamFn);

  const events: AgentEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    console.log(`  事件: ${event.type}`);
  }
  const messages = await stream.result();

  console.log("\n" + "=".repeat(60));
  console.log("结果：");
  console.log("=".repeat(60));
  console.log(`总事件数: ${events.length}`);
  console.log(`新增消息数: ${messages.length}`);
  console.log(`LLM 调用次数: ${callCount}`);

  console.log("\n最终上下文：");
  const allMessages = [...context.messages, ...messages];
  allMessages.forEach((m, i) => {
    const role = m.role;
    const text = m.role === "assistant"
      ? m.content.find((c) => c.type === "text")
      : m.role === "user" ? { text: m.content } : m.content.find((c) => c.type === "text");
    console.log(`  ${i + 1}. [${role}] ${text && "text" in text ? text.text : "..."}`);
  });

  console.log("\n结论：");
  console.log("  - agentLoopContinue 不加新消息，直接从现有上下文续跑");
  console.log("  - 适用于重试场景（上一轮工具失败，需要重新执行）");
  console.log("  - 前置校验：上下文非空，最后一条不是 assistant");
}

main().catch(console.error);
