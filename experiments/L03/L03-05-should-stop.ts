/**
 * 实验5：shouldStopAfterTurn 提前停止
 *
 * 场景：每轮结束时检查，如果已经调了2次工具就强制停止
 *
 * 假 LLM 行为：
 *   第1次：调 getWeather
 *   第2次：调 translate（应该被 shouldStopAfterTurn 拦住）
 *   第3次：（不会执行，因为第2轮后就停了）
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-course/experiments/experiment-5-should-stop.ts
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

const weatherSchema = Type.Object({ city: Type.String() });
const weatherTool: AgentTool<typeof weatherSchema> = {
  name: "getWeather",
  label: "获取天气",
  description: "获取指定城市的天气",
  parameters: weatherSchema,
  async execute(_id, params) {
    console.log(`  [工具] getWeather("${params.city}")`);
    return {
      content: [{ type: "text", text: `${params.city}今天25°C` }],
      details: null,
    };
  },
};

const translateSchema = Type.Object({ text: Type.String(), to: Type.String() });
const translateTool: AgentTool<typeof translateSchema> = {
  name: "translate",
  label: "翻译",
  description: "将文本翻译成指定语言",
  parameters: translateSchema,
  async execute(_id, params) {
    console.log(`  [工具] translate("${params.text}" → ${params.to})`);
    return {
      content: [{ type: "text", text: `[${params.to}] ${params.text}` }],
      details: null,
    };
  },
};

let callCount = 0;
let toolCallCount = 0;

function fakeStreamFn() {
  const stream = new MockAssistantStream();
  queueMicrotask(() => {
    callCount++;
    if (callCount === 1) {
      console.log("[假LLM] 第1次 → 调 getWeather");
      const message = createAssistantMessage(
        [{ type: "toolCall", id: "tc-1", name: "getWeather", arguments: { city: "北京" } }],
        "toolUse",
      );
      stream.push({ type: "done", reason: "toolUse", message });
    } else if (callCount === 2) {
      console.log("[假LLM] 第2次 → 调 translate（应该被拦住！）");
      const message = createAssistantMessage(
        [{ type: "toolCall", id: "tc-2", name: "translate", arguments: { text: "晴天", to: "English" } }],
        "toolUse",
      );
      stream.push({ type: "done", reason: "toolUse", message });
    } else {
      console.log(`[假LLM] 第${callCount}次 → 最终文本（不应该到这里）`);
      const message = createAssistantMessage([
        { type: "text", text: "全部完成。" },
      ]);
      stream.push({ type: "done", reason: "stop", message });
    }
  });
  return stream;
}

async function main() {
  console.log("=".repeat(60));
  console.log("实验5：shouldStopAfterTurn 提前停止");
  console.log("=".repeat(60));
  console.log("规则：每轮结束后，如果已调了 ≥2 次工具就停止");
  console.log("=".repeat(60));

  const context: AgentContext = {
    systemPrompt: "你是一个助手。",
    messages: [],
    tools: [weatherTool, translateTool],
  };

  const userPrompt = createUserMessage("北京天气？翻译成英文？再查上海天气？");
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: (messages) =>
      messages.filter((m) =>
        m.role === "user" || m.role === "assistant" || m.role === "toolResult",
      ) as Message[],
    shouldStopAfterTurn: async (ctx) => {
      const thisRoundToolCount = ctx.toolResults.length;
      toolCallCount += thisRoundToolCount;
      console.log(`  [检查] shouldStopAfterTurn: 本轮工具数=${thisRoundToolCount}, 累计=${toolCallCount}`);

      if (toolCallCount >= 2) {
        console.log(`  [检查] ⚠️  累计工具调用 ≥2，强制停止！`);
        return true;
      }
      console.log(`  [检查] ✅ 还没到限制，继续`);
      return false;
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
  console.log(`消息角色: ${messages.map((m) => m.role).join(" → ")}`);
  console.log(`LLM 调用次数: ${callCount}`);
  console.log(`工具调用次数: ${toolCallCount}`);

  console.log("\n事件时序:");
  events.forEach((e, i) => {
    const tag =
      e.type === "tool_execution_start" ? ` ← ${e.toolName}` :
      e.type === "tool_execution_end" ? ` ← isError=${e.isError}` : "";
    console.log(`  ${i + 1}. ${e.type}${tag}`);
  });

  console.log("\n结论：");
  console.log("  - 第1轮：getWeather 执行，累计=1，继续");
  console.log("  - 第2轮：translate 执行，累计=2，触发停止");
  console.log("  - shouldStopAfterTurn 返回 true → 循环立即停止");
  console.log("  - 第3次 LLM 调用不会发生");
}

main().catch(console.error);
