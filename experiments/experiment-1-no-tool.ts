/**
 * 实验1：LLM 直接返回文本（不调工具）
 *
 * 对比原版：
 *   原版：16个事件，4条消息，2轮
 *   本版：8个事件，2条消息，1轮
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-course/experiments/experiment-1-no-tool.ts
 */

import {
  type AssistantMessage,
  type AssistantMessageEvent,
  EventStream,
  type Message,
  type Model,
  type UserMessage,
} from "../src/pi-ai.ts";
import { agentLoop } from "../src/agent-loop.ts";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
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

let callCount = 0;

function fakeStreamFn() {
  const stream = new MockAssistantStream();
  queueMicrotask(() => {
    callCount++;
    console.log(`[假LLM] 第${callCount}次被调用 → 直接返回文本`);
    const message = createAssistantMessage([
      { type: "text", text: "北京今天25°C，是个好天气！" },
    ]);
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}

async function main() {
  console.log("=".repeat(60));
  console.log("实验1：LLM 直接返回文本，不调工具");
  console.log("=".repeat(60));

  const context: AgentContext = {
    systemPrompt: "你是一个天气助手。",
    messages: [],
    tools: [],
  };

  const userPrompt = createUserMessage("北京今天天气怎么样？");
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: (messages) =>
      messages.filter((m) =>
        m.role === "user" || m.role === "assistant" || m.role === "toolResult",
      ) as Message[],
  };

  const stream = agentLoop([userPrompt], context, config, undefined, fakeStreamFn);
  const events: AgentEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    console.log(`  事件: ${event.type}`);
  }
  const messages = await stream.result();

  console.log("\n" + "=".repeat(60));
  console.log("结果：");
  console.log("=".repeat(60));
  console.log(`总事件数: ${events.length}  (原版16个)`);
  console.log(`总消息数: ${messages.length}  (原版4条)`);
  console.log(`消息角色: ${messages.map((m) => m.role).join(" → ")}`);
  console.log(`LLM调用次数: ${callCount}  (原版2次)`);
  console.log(`事件类型: ${[...new Set(events.map((e) => e.type))].join(", ")}`);
  console.log("\n事件时序:");
  events.forEach((e, i) => console.log(`  ${i + 1}. ${e.type}`));
  console.log("\n结论：没有工具调用 → 没有 tool_execution_start/end → 1轮结束");
}

main().catch(console.error);
