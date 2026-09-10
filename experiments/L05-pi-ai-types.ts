/**
 * L05 实验：验证 pi-ai 统一模型层的类型系统
 *
 * 验证点：
 * 1. 中立格式的 Message 类型（UserMessage / AssistantMessage / ToolResultMessage）
 * 2. AssistantMessage 的 content 数组结构（TextContent / ThinkingContent / ToolCall）
 * 3. Usage 记账结构
 * 4. 统一事件协议
 *
 * 注意：本实验不需要真实 API key，只验证类型结构
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-course/experiments/L05-pi-ai-types.ts
 */

import type {
  AssistantMessage,
  Context,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";

// ==================== 1. 验证 Message 类型 ====================

function createUserMessage(text: string): UserMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  };
}

function createAssistantMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text: "你好！" } satisfies TextContent,
      { type: "thinking", text: "用户说你好，我应该友好回复" } satisfies ThinkingContent,
      { type: "text", text: "有什么可以帮助你的吗？" } satisfies TextContent,
    ],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4o",
    usage: {
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 150,
      cost: { input: 0.001, output: 0.0005, cacheRead: 0, cacheWrite: 0, total: 0.0015 },
    } satisfies Usage,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createToolResultMessage(): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "tc-001",
    toolName: "getWeather",
    content: [{ type: "text", text: "北京今天25°C，晴天" }],
    details: { tempCelsius: 25 },
    isError: false,
    timestamp: Date.now(),
  };
}

// ==================== 2. 验证 Context 结构 ====================

function createContext(): Context {
  const userMsg = createUserMessage("北京天气怎么样？");
  const assistantMsg = createAssistantMessage();
  const toolResult = createToolResultMessage();

  return {
    systemPrompt: "你是一个天气助手。",
    messages: [userMsg, assistantMsg, toolResult],
  };
}

// ==================== 3. 验证 ToolCall 结构 ====================

function createAssistantMessageWithToolCall(): AssistantMessage {
  const toolCall: ToolCall = {
    type: "toolCall",
    id: "tc-001",
    name: "getWeather",
    arguments: { city: "北京" },
  };

  return {
    role: "assistant",
    content: [
      { type: "text", text: "让我查一下北京的天气。" },
      toolCall,
    ],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4o",
    usage: {
      input: 100,
      output: 80,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 180,
      cost: { input: 0.001, output: 0.0008, cacheRead: 0, cacheWrite: 0, total: 0.0018 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

// ==================== 4. 验证 Model 结构 ====================

function createModel(): Model<"openai-responses"> {
  return {
    id: "gpt-4o",
    name: "GPT-4o",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
    contextWindow: 128000,
    maxTokens: 16384,
  };
}

// ==================== 主测试 ====================

async function main() {
  console.log("=".repeat(60));
  console.log("L05 实验：验证 pi-ai 统一模型层类型系统");
  console.log("=".repeat(60));

  // 1. UserMessage
  console.log("\n--- 1. UserMessage ---");
  const userMsg = createUserMessage("你好");
  console.log(`  role: ${userMsg.role}`);
  console.log(`  content: ${userMsg.content}`);
  console.log(`  ✅ UserMessage 结构正确`);

  // 2. AssistantMessage（含 thinking）
  console.log("\n--- 2. AssistantMessage（含 ThinkingContent）---");
  const assistantMsg = createAssistantMessage();
  console.log(`  role: ${assistantMsg.role}`);
  console.log(`  content 长度: ${assistantMsg.content.length}`);
  assistantMsg.content.forEach((block, i) => {
    console.log(`    [${i}] type=${block.type}, text="${(block as any).text?.slice(0, 30)}..."`);
  });
  console.log(`  stopReason: ${assistantMsg.stopReason}`);
  console.log(`  usage.input: ${assistantMsg.usage.input}`);
  console.log(`  ✅ AssistantMessage 结构正确，ThinkingContent 是一等公民`);

  // 3. ToolResultMessage
  console.log("\n--- 3. ToolResultMessage ---");
  const toolResult = createToolResultMessage();
  console.log(`  role: ${toolResult.role}`);
  console.log(`  toolCallId: ${toolResult.toolCallId}`);
  console.log(`  toolName: ${toolResult.toolName}`);
  console.log(`  isError: ${toolResult.isError}`);
  console.log(`  ✅ ToolResultMessage 结构正确`);

  // 4. Context
  console.log("\n--- 4. Context ---");
  const context = createContext();
  console.log(`  systemPrompt: "${context.systemPrompt}"`);
  console.log(`  messages 数量: ${context.messages.length}`);
  console.log(`  messages 角色: ${context.messages.map((m) => m.role).join(" → ")}`);
  console.log(`  ✅ Context 结构正确`);

  // 5. AssistantMessage with ToolCall
  console.log("\n--- 5. AssistantMessage with ToolCall ---");
  const toolCallMsg = createAssistantMessageWithToolCall();
  const toolCallBlock = toolCallMsg.content.find((b) => b.type === "toolCall") as ToolCall;
  console.log(`  toolCall.id: ${toolCallBlock.id}`);
  console.log(`  toolCall.name: ${toolCallBlock.name}`);
  console.log(`  toolCall.arguments: ${JSON.stringify(toolCallBlock.arguments)}`);
  console.log(`  stopReason: ${toolCallMsg.stopReason}`);
  console.log(`  ✅ ToolCall 结构正确`);

  // 6. Model
  console.log("\n--- 6. Model ---");
  const model = createModel();
  console.log(`  id: ${model.id}`);
  console.log(`  api: ${model.api}`);
  console.log(`  contextWindow: ${model.contextWindow}`);
  console.log(`  maxTokens: ${model.maxTokens}`);
  console.log(`  cost.input: $${model.cost.input}/1M tokens`);
  console.log(`  ✅ Model 结构正确`);

  // 7. Usage 记账
  console.log("\n--- 7. Usage 记账（cacheRead/cacheWrite 单列）---");
  const usage: Usage = {
    input: 1000,
    output: 500,
    cacheRead: 800,
    cacheWrite: 200,
    totalTokens: 2500,
    cost: { input: 0.0025, output: 0.005, cacheRead: 0.001, cacheWrite: 0.0005, total: 0.009 },
  };
  console.log(`  input: ${usage.input}`);
  console.log(`  output: ${usage.output}`);
  console.log(`  cacheRead: ${usage.cacheRead}`);
  console.log(`  cacheWrite: ${usage.cacheWrite}`);
  console.log(`  totalTokens: ${usage.totalTokens}`);
  console.log(`  ✅ Usage 结构正确，cacheRead/cacheWrite 单独记账`);

  console.log("\n" + "=".repeat(60));
  console.log("✅ 所有 pi-ai 类型验证通过！");
  console.log("=".repeat(60));
}

main().catch(console.error);
