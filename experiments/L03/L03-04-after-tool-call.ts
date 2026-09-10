/**
 * 实验4：afterToolCall 修改工具结果
 *
 * 场景：工具返回了原始结果，但 afterToolCall 在返回给模型之前做了脱敏/改写
 *
 * 假 LLM 行为：
 *   第1次：调 getWeather 工具
 *   第2次：返回最终文本
 *
 * afterToolCall 做的事：
 *   - 给 content 加一行审计日志
 *   - 把 details 里的 temp 改成 Fahrenheit
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-agent-loop-labs/experiments/L03/L03-04-after-tool-call.ts
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
const weatherTool: AgentTool<typeof weatherSchema, { tempCelsius: number }> = {
  name: "getWeather",
  label: "获取天气",
  description: "获取指定城市的天气",
  parameters: weatherSchema,
  async execute(_id, params) {
    console.log(`  [工具] getWeather("${params.city}") → 返回 25°C`);
    return {
      content: [{ type: "text", text: `${params.city}今天25°C，晴天` }],
      details: { tempCelsius: 25 },
    };
  },
};

let callCount = 0;

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
    } else {
      console.log("[假LLM] 第2次 → 最终文本");
      const message = createAssistantMessage([
        { type: "text", text: "查询完毕。" },
      ]);
      stream.push({ type: "done", reason: "stop", message });
    }
  });
  return stream;
}

async function main() {
  console.log("=".repeat(60));
  console.log("实验4：afterToolCall 修改工具结果");
  console.log("=".repeat(60));

  const context: AgentContext = {
    systemPrompt: "你是一个天气助手。",
    messages: [],
    tools: [weatherTool],
  };

  const userPrompt = createUserMessage("北京天气？");
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: (messages) =>
      messages.filter((m) =>
        m.role === "user" || m.role === "assistant" || m.role === "toolResult",
      ) as Message[],
    afterToolCall: async (ctx) => {
      console.log(`  [改写] afterToolCall: ${ctx.toolCall.name}`);
      console.log(`  [改写] 原始 content: "${ctx.result.content[0]?.type === "text" ? ctx.result.content[0].text : "N/A"}"`);
      console.log(`  [改写] 原始 details:`, ctx.result.details);

      if (ctx.toolCall.name === "getWeather") {
        const originalText = ctx.result.content[0]?.type === "text" ? ctx.result.content[0].text : "";
        const newContent = [
          { type: "text" as const, text: `${originalText}\n[审计] 查询时间: ${new Date().toISOString()}` },
        ];
        const celsius = (ctx.result.details as any)?.tempCelsius ?? 0;
        const newDetails = { tempCelsius: celsius, tempFahrenheit: celsius * 9 / 5 + 32 };

        console.log(`  [改写] ✅ content 加了审计日志`);
        console.log(`  [改写] ✅ details 加了 Fahrenheit: ${newDetails.tempFahrenheit}°F`);
        return { content: newContent, details: newDetails };
      }
      return undefined;
    },
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

  const toolResult = messages.find((m) => m.role === "toolResult");
  if (toolResult) {
    const text = toolResult.content.find((c) => c.type === "text");
    console.log(`工具结果 content:\n  "${text && "text" in text ? text.text : "N/A"}"`);
    console.log(`工具结果 details:`);
    console.log(`  ${JSON.stringify(toolResult.details, null, 2)}`);
  }

  console.log("\n结论：");
  console.log("  - 工具 execute 返回原始结果（25°C）");
  console.log("  - afterToolCall 改写了 content（加审计日志）和 details（加 Fahrenheit）");
  console.log("  - 模型看到的是改写后的内容");
}

main().catch(console.error);
