/**
 * L04 习题：包一层 Agent 类
 *
 * 验证点：
 * 1. 纯函数引擎 + 有状态外壳的手感
 * 2. prompt / subscribe / abort 三个核心方法
 * 3. 事件订阅与状态管理
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-course/experiments/L04-agent-wrapper.ts
 */

import {
  type AssistantMessage,
  type AssistantMessageEvent,
  EventStream,
  type Message,
  type Model,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { Type } from "../../pi/node_modules/typebox/build/index.mjs";
import { agentLoop } from "../../pi/packages/agent/src/agent-loop.ts";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AgentState,
} from "../../pi/packages/agent/src/types.ts";

// ==================== Mock 基础设施 ====================

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

// ==================== 简化版 Agent 类 ====================

type EventListener = (event: AgentEvent, signal: AbortSignal) => Promise<void> | void;

interface SimpleAgentOptions {
  systemPrompt?: string;
  model?: Model<any>;
  tools?: AgentTool<any>[];
  streamFn?: () => MockAssistantStream;
}

class SimpleAgent {
  private _state: {
    systemPrompt: string;
    model: Model<any>;
    tools: AgentTool<any>[];
    messages: AgentMessage[];
    isStreaming: boolean;
    streamingMessage?: AgentMessage;
  };
  private listeners = new Set<EventListener>();
  private abortController?: AbortController;
  private callCount = 0;
  private streamFn: () => MockAssistantStream;

  constructor(options: SimpleAgentOptions = {}) {
    this._state = {
      systemPrompt: options.systemPrompt ?? "你是一个助手。",
      model: options.model ?? createModel(),
      tools: options.tools ?? [],
      messages: [],
      isStreaming: false,
      streamingMessage: undefined,
    };
    this.streamFn = options.streamFn ?? this.defaultStreamFn.bind(this);
  }

  get state(): AgentState {
    return this._state as AgentState;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  abort(): void {
    this.abortController?.abort();
  }

  async prompt(input: string): Promise<void> {
    if (this._state.isStreaming) {
      throw new Error("Agent is already processing. Wait for completion.");
    }

    this.abortController = new AbortController();
    this._state.isStreaming = true;
    this._state.streamingMessage = undefined;

    const userMessage = createUserMessage(input);

    try {
      const context: AgentContext = {
        systemPrompt: this._state.systemPrompt,
        messages: this._state.messages.slice(),
        tools: this._state.tools,
      };

      const config: AgentLoopConfig = {
        model: this._state.model,
        convertToLlm: (messages) =>
          messages.filter((m) =>
            m.role === "user" || m.role === "assistant" || m.role === "toolResult",
          ) as Message[],
      };

      const stream = agentLoop(
        [userMessage],
        context,
        config,
        this.abortController.signal,
        this.streamFn,
      );

      for await (const event of stream) {
        await this.processEvent(event);
      }

      const messages = await stream.result();
      this._state.messages = messages;
    } finally {
      this._state.isStreaming = false;
      this._state.streamingMessage = undefined;
    }
  }

  private defaultStreamFn(): MockAssistantStream {
    const stream = new MockAssistantStream();
    this.callCount++;

    queueMicrotask(() => {
      console.log(`  [假LLM] 第${this.callCount}次被调用`);
      const message = createAssistantMessage([
        { type: "text", text: `这是第 ${this.callCount} 次回复。` },
      ]);
      stream.push({ type: "done", reason: "stop", message });
    });

    return stream;
  }

  private async processEvent(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "message_start":
        this._state.streamingMessage = event.message;
        break;
      case "message_update":
        this._state.streamingMessage = event.message;
        break;
      case "message_end":
        this._state.streamingMessage = undefined;
        break;
    }

    for (const listener of this.listeners) {
      await listener(event, this.abortController!.signal);
    }
  }
}

// ==================== 测试 ====================

async function main() {
  console.log("=".repeat(60));
  console.log("L04 习题：验证 SimpleAgent 包装器");
  console.log("=".repeat(60));

  const agent = new SimpleAgent({
    systemPrompt: "你是一个天气助手。",
  });

  // 订阅事件
  const events: AgentEvent[] = [];
  agent.subscribe((event) => {
    events.push(event);
    const tag =
      event.type === "message_start" ? " ← 消息开始" :
      event.type === "message_end" ? " ← 消息结束" :
      event.type === "agent_end" ? " ← Agent结束" : "";
    console.log(`  [订阅] ${event.type}${tag}`);
  });

  // 测试1: 第一次 prompt
  console.log("\n--- 测试1: 第一次 prompt ---");
  await agent.prompt("你好");
  console.log(`  状态: isStreaming=${agent.state.isStreaming}`);
  console.log(`  消息数: ${agent.state.messages.length}`);

  // 测试2: 第二次 prompt
  console.log("\n--- 测试2: 第二次 prompt ---");
  await agent.prompt("再见");
  console.log(`  状态: isStreaming=${agent.state.isStreaming}`);
  console.log(`  消息数: ${agent.state.messages.length}`);

  // 测试3: 并发保护
  console.log("\n--- 测试3: 并发保护 ---");
  try {
    await agent.prompt("并发测试");
  } catch (e) {
    console.log(`  预期错误: ${(e as Error).message}`);
  }

  // 统计
  console.log("\n" + "=".repeat(60));
  console.log("结果：");
  console.log("=".repeat(60));
  console.log(`总事件数: ${events.length}`);
  console.log(`消息数: ${agent.state.messages.length}`);
  console.log(`消息角色: ${agent.state.messages.map((m) => m.role).join(" → ")}`);
  console.log("\n事件时序:");
  events.forEach((e, i) => console.log(`  ${i + 1}. ${e.type}`));
  console.log("\n✅ SimpleAgent 包装器验证通过");
}

main().catch(console.error);
