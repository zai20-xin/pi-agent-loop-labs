/**
 * 实验6：链式依赖 —— 工具B依赖工具A的结果
 *
 * 场景：
 *   第1轮：用户问"北京天气怎么样？适合跑步吗？"
 *   LLM 调 getWeather("北京") → 得到"25°C，晴天"
 *   第2轮：LLM 看到天气结果，决定调 getAdvice("25°C，晴天")
 *   第3轮：LLM 拿到综合建议，回复用户
 *
 * 这就是真实 agent 的核心模式：
 *   LLM 思考 → 调工具 → 看结果 → 再思考 → 再调工具 → ...
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-agent-loop-labs/experiments/L03/L03-06-chain-dependency.ts
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

// ========== 工具1：获取天气 ==========

const weatherSchema = Type.Object({ city: Type.String() });
const weatherTool: AgentTool<typeof weatherSchema> = {
  name: "getWeather",
  label: "获取天气",
  description: "获取指定城市的天气",
  parameters: weatherSchema,
  async execute(_id, params) {
    console.log(`  [工具] getWeather("${params.city}") → "25°C，晴天"`);
    return {
      content: [{ type: "text", text: `${params.city}今天25°C，晴天` }],
      details: null,
    };
  },
};

// ========== 工具2：根据天气给建议（依赖天气结果） ==========

const adviceSchema = Type.Object({ weatherInfo: Type.String() });
const adviceTool: AgentTool<typeof adviceSchema> = {
  name: "getAdvice",
  label: "运动建议",
  description: "根据天气信息给出运动建议",
  parameters: adviceSchema,
  async execute(_id, params) {
    console.log(`  [工具] getAdvice("${params.weatherInfo}")`);
    // 模拟：根据天气信息生成建议
    const isGood = params.weatherInfo.includes("晴");
    const advice = isGood
      ? "天气很好，适合户外跑步！建议下午4点出发。"
      : "天气不太好，建议室内运动。";
    console.log(`  [工具] getAdvice → "${advice}"`);
    return {
      content: [{ type: "text", text: advice }],
      details: null,
    };
  },
};

// ========== 关键：假 LLM 的行为按轮次变化 ==========

let callCount = 0;

function fakeStreamFn() {
  const stream = new MockAssistantStream();

  queueMicrotask(() => {
    callCount++;

    if (callCount === 1) {
      // 第1次调用：LLM 决定先查天气
      console.log("[假LLM] 第1次 → 调 getWeather（查天气）");
      const message = createAssistantMessage(
        [{ type: "toolCall", id: "tc-1", name: "getWeather", arguments: { city: "北京" } }],
        "toolUse",
      );
      stream.push({ type: "done", reason: "toolUse", message });

    } else if (callCount === 2) {
      // 第2次调用：LLM 看到了"25°C，晴天"，决定调 getAdvice
      console.log("[假LLM] 第2次 → 调 getAdvice（基于天气结果给建议）");
      const message = createAssistantMessage(
        [{ type: "toolCall", id: "tc-2", name: "getAdvice", arguments: { weatherInfo: "25°C，晴天" } }],
        "toolUse",
      );
      stream.push({ type: "done", reason: "toolUse", message });

    } else {
      // 第3次调用：LLM 拿到所有信息，回复用户
      console.log("[假LLM] 第3次 → 返回最终回复");
      const message = createAssistantMessage([
        { type: "text", text: "北京今天25°C，晴天。天气很好，适合户外跑步！建议下午4点出发。" },
      ]);
      stream.push({ type: "done", reason: "stop", message });
    }
  });

  return stream;
}

// ========== 运行 ==========

async function main() {
  console.log("=".repeat(60));
  console.log("实验6：链式依赖 —— 工具B依赖工具A的结果");
  console.log("=".repeat(60));
  console.log("流程：查天气 → 看结果 → 给建议 → 回复用户");
  console.log("=".repeat(60));

  const context: AgentContext = {
    systemPrompt: "你是一个运动助手。先查天气，再给建议。",
    messages: [],
    tools: [weatherTool, adviceTool],
  };

  const userPrompt = createUserMessage("北京天气怎么样？适合跑步吗？");

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
  console.log(`消息角色: ${messages.map((m) => m.role).join(" → ")}`);
  console.log(`LLM 调用次数: ${callCount}`);

  console.log("\n上下文中的消息链：");
  messages.forEach((m, i) => {
    if (m.role === "user") {
      console.log(`  ${i + 1}. [user] "${m.content}"`);
    } else if (m.role === "assistant") {
      const text = m.content.find((c) => c.type === "text");
      const toolCall = m.content.find((c) => c.type === "toolCall");
      if (text) {
        console.log(`  ${i + 1}. [assistant] "${text.type === "text" ? text.text : ""}"`);
      }
      if (toolCall) {
        console.log(`  ${i + 1}. [assistant] 调用 ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`);
      }
    } else if (m.role === "toolResult") {
      const text = m.content.find((c) => c.type === "text");
      console.log(`  ${i + 1}. [toolResult] ${m.toolName} → "${text && "text" in text ? text.text : "N/A"}"`);
    }
  });

  console.log("\n事件时序:");
  events.forEach((e, i) => {
    const tag =
      e.type === "tool_execution_start" ? ` ← ${e.toolName}` :
      e.type === "tool_execution_end" ? ` ← isError=${e.isError}` : "";
    console.log(`  ${i + 1}. ${e.type}${tag}`);
  });

  console.log("\n结论：");
  console.log("  - 第1轮：LLM 调 getWeather → 得到天气结果");
  console.log("  - 第2轮：LLM 看到天气结果，调 getAdvice（参数来自上一轮结果）");
  console.log("  - 第3轮：LLM 拿到建议，回复用户");
  console.log("  - 关键：getAdvice 的参数 weatherInfo='25°C，晴天' 来自 getWeather 的返回");
  console.log("  - 这就是 LLM 的'思考→行动→观察→思考'循环");
  console.log("  - 真实 agent 中，每轮的工具选择和参数都由 LLM 根据上下文动态决定");
}

main().catch(console.error);
