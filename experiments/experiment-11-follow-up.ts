/**
 * 实验11：getFollowUpMessages 追加消息
 *
 * 场景：agent 本来要停了，但发现还有排队消息就继续跑
 *       与插话不同：追加不打断当前工作流，只续命
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-course/experiments/experiment-11-follow-up.ts
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

// ========== 假 LLM：第一次返回文本，第二次返回另一个文本 ==========

let callCount = 0;

function fakeStreamFn() {
  const stream = new MockAssistantStream();
  queueMicrotask(() => {
    callCount++;
    if (callCount === 1) {
      console.log("[假LLM] 第1次 → 回复第一个问题");
      const message = createAssistantMessage([
        { type: "text", text: "北京今天25°C，晴天。" },
      ]);
      stream.push({ type: "done", reason: "stop", message });
    } else {
      console.log("[假LLM] 第2次 → 回复追加问题");
      const message = createAssistantMessage([
        { type: "text", text: "上海今天28°C，多云。" },
      ]);
      stream.push({ type: "done", reason: "stop", message });
    }
  });
  return stream;
}

// ========== 运行 ==========

async function main() {
  console.log("=".repeat(60));
  console.log("实验11：getFollowUpMessages 追加消息");
  console.log("=".repeat(60));
  console.log("场景：agent 回复完第一个问题后，发现还有追加消息");
  console.log("=".repeat(60));

  const context: AgentContext = {
    systemPrompt: "你是一个天气助手。",
    messages: [],
    tools: [],
  };

  const userPrompt = createUserMessage("北京天气怎么样？");
  let followUpRound = 0;

  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: (messages) =>
      messages.filter((m) =>
        m.role === "user" || m.role === "assistant" || m.role === "toolResult",
      ) as Message[],

    // 关键：agent 本来要停了，但发现还有追加消息
    getFollowUpMessages: async () => {
      followUpRound++;
      if (followUpRound === 1) {
        console.log("  [追加] getFollowUpMessages 第1次 → 返回追加问题！");
        return [createUserMessage("上海呢？")];
      }
      console.log("  [追加] getFollowUpMessages 第${followUpRound}次 → 返回空");
      return [];
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
    }
    console.log(`  ${i + 1}. [${role}] "${text}"`);
  });

  console.log("\n结论：");
  console.log("  - 第1轮：回复'北京天气怎么样？'");
  console.log("  - agent 本来要停，但 getFollowUpMessages 返回了追加消息");
  console.log("  - 追加消息注入上下文，继续第2轮");
  console.log("  - 第2轮：回复'上海呢？'");
  console.log("  - 追加 vs 插话：追加不打断当前工作流，只续命");
}

main().catch(console.error);
