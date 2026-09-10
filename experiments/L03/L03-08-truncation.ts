/**
 * 实验8：截断作废（stopReason=="length"）
 *
 * 场景：LLM 输出被 token 上限截断，工具调用参数可能不完整
 *       框架不执行这些工具，而是批量生成 error result，提示模型重发
 *
 * 假 LLM 行为：
 *   第1次：返回 toolCall，但 stopReason="length"（截断）
 *   第2次：返回最终文本
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-agent-loop-labs/experiments/L03/L03-08-truncation.ts
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
    console.log(`  [工具] exec("${params.command}") — 如果到这里就错了！`);
    return {
      content: [{ type: "text", text: `执行: ${params.command}` }],
      details: null,
    };
  },
};

// ========== 假 LLM：第一次返回截断的消息 ==========

let callCount = 0;

function fakeStreamFn() {
  const stream = new MockAssistantStream();
  queueMicrotask(() => {
    callCount++;
    if (callCount === 1) {
      // 第1次：输出被截断，工具调用参数可能不完整
      console.log("[假LLM] 第1次 → 返回 toolCall + stopReason='length'（截断！）");
      const message = createAssistantMessage(
        [{ type: "toolCall", id: "tc-1", name: "exec", arguments: { command: "rm -rf /tmp/te" } }],
        "length",  // 截断！参数可能不完整
      );
      stream.push({ type: "done", reason: "length", message });
    } else {
      console.log("[假LLM] 第2次 → 返回最终文本");
      const message = createAssistantMessage([
        { type: "text", text: "命令执行完毕。" },
      ]);
      stream.push({ type: "done", reason: "stop", message });
    }
  });
  return stream;
}

// ========== 运行 ==========

async function main() {
  console.log("=".repeat(60));
  console.log("实验8：截断作废（stopReason=='length'）");
  console.log("=".repeat(60));
  console.log("场景：LLM 输出被 token 上限截断，工具参数可能不完整");
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

  // 查看工具结果
  const toolResults = messages.filter((m) => m.role === "toolResult");
  console.log("\n工具结果：");
  for (const tr of toolResults) {
    const text = tr.content.find((c) => c.type === "text");
    console.log(`  ${tr.toolName}: isError=${tr.isError}`);
    console.log(`    内容: "${text && "text" in text ? text.text : "N/A"}"`);
  }

  console.log("\n事件时序：");
  events.forEach((e, i) => {
    const tag =
      e.type === "tool_execution_start" ? ` ← ${e.toolName}` :
      e.type === "tool_execution_end" ? ` ← isError=${e.isError}` : "";
    console.log(`  ${i + 1}. ${e.type}${tag}`);
  });

  console.log("\n结论：");
  console.log("  - stopReason='length' 时，工具没有被执行");
  console.log("  - 框架自动生成 isError=true 的 error result");
  console.log("  - 错误信息提示模型'参数可能被截断，请重新发起'");
  console.log("  - 宁可让模型重来，不可带着残缺参数执行（防线1）");
}

main().catch(console.error);
