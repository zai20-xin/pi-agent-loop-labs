/**
 * 实验12：prepareNextTurn 热切换模型
 *
 * 场景：第1轮用普通模型，第2轮切换到"更强"的模型
 *       prepareNextTurn 在 turn_end 后、下一轮开始前执行
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-course/experiments/experiment-12-hot-switch.ts
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

function createModel(id: string, name: string): Model<"openai-responses"> {
  return {
    id, name, api: "openai-responses",
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

// ========== 假 LLM：记录每轮使用的模型 ==========

let callCount = 0;
let lastModelUsed = "";

function fakeStreamFn(modelId: string) {
  const stream = new MockAssistantStream();
  queueMicrotask(() => {
    callCount++;
    lastModelUsed = modelId;
    console.log(`[假LLM] 第${callCount}次被调用 (模型: ${modelId})`);

    if (callCount === 1) {
      const message = createAssistantMessage([
        { type: "text", text: `[${modelId}] 第1轮回复：简单问题` },
      ]);
      stream.push({ type: "done", reason: "stop", message });
    } else {
      const message = createAssistantMessage([
        { type: "text", text: `[${modelId}] 第2轮回复：复杂问题（用更强模型）` },
      ]);
      stream.push({ type: "done", reason: "stop", message });
    }
  });
  return stream;
}

// ========== 运行 ==========

async function main() {
  console.log("=".repeat(60));
  console.log("实验12：prepareNextTurn 热切换模型");
  console.log("=".repeat(60));
  console.log("场景：第1轮用 gpt-4o，第2轮切换到 o1");
  console.log("=".repeat(60));

  const context: AgentContext = {
    systemPrompt: "你是一个助手。",
    messages: [],
    tools: [],
  };

  const userPrompt = createUserMessage("简单问题→复杂问题");

  let currentModelId = "gpt-4o";
  const modelGpt4o = createModel("gpt-4o", "GPT-4o");
  const modelO1 = createModel("o1", "O1");

  let followUpRound = 0;

  const config: AgentLoopConfig = {
    model: modelGpt4o,
    convertToLlm: (messages) =>
      messages.filter((m) =>
        m.role === "user" || m.role === "assistant" || m.role === "toolResult",
      ) as Message[],

    // 关键：第1轮结束后切换模型
    prepareNextTurn: async (ctx) => {
      console.log(`  [切换] prepareNextTurn: 当前模型=${currentModelId}`);
      if (currentModelId === "gpt-4o") {
        currentModelId = "o1";
        console.log(`  [切换] ✅ 切换到 o1！`);
        return { model: modelO1 };
      }
      console.log(`  [切换] 不切换`);
      return undefined;
    },

    // 关键：第1轮后返回追加消息，触发第2轮
    getFollowUpMessages: async () => {
      followUpRound++;
      if (followUpRound === 1) {
        console.log("  [追加] getFollowUpMessages → 返回追加问题！");
        return [createUserMessage("复杂问题也回答一下")];
      }
      return [];
    },
  };

  // 包装 streamFn，根据当前模型创建不同的假 LLM
  const streamFn = () => fakeStreamFn(currentModelId);

  const stream = agentLoop([userPrompt], context, config, undefined, streamFn);
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
  console.log("  - 第1轮用 gpt-4o 回复简单问题");
  console.log("  - prepareNextTurn 在 turn_end 后切换到 o1");
  console.log("  - 第2轮用 o1 回复复杂问题");
  console.log("  - 典型用途：简单问题用便宜模型，复杂问题切贵模型");
  console.log("  - 也可以热切换上下文（裁剪旧消息、注入新 context）");
}

main().catch(console.error);
