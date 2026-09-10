# L05：pi-ai 类型系统

## 核心教材

- `packages/pi-ai/src/types.ts` — 核心类型定义
- `experiments/L05-pi-ai-types.ts` — 实验代码

## 知识点清单

1. 中立格式的 Message 类型（UserMessage / AssistantMessage / ToolResultMessage）
2. AssistantMessage 的 content 数组结构（TextContent / ThinkingContent / ToolCall）
3. Usage 记账结构
4. 统一事件协议
5. Model 结构
6. Context 结构

## 详细讲解

### 1. Message 类型体系

```typescript
type Message = UserMessage | AssistantMessage | ToolResultMessage;

interface UserMessage {
  role: "user";
  content: string;
  timestamp: number;
}

interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];  // 多种内容块
  api: string;
  provider: string;
  model: string;
  usage: Usage;
  stopReason: "stop" | "toolUse";
  timestamp: number;
}

interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ContentBlock[];
  details?: any;
  isError: boolean;
  timestamp: number;
}
```

### 2. ContentBlock 类型

```typescript
type ContentBlock = TextContent | ThinkingContent | ToolCall;

interface TextContent {
  type: "text";
  text: string;
}

interface ThinkingContent {
  type: "thinking";
  text: string;  // 思考过程
}

interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: any;
}
```

### 3. Usage 记账结构

```typescript
interface Usage {
  input: number;      // 输入 token 数
  output: number;     // 输出 token 数
  cacheRead: number;  // 缓存读取 token 数
  cacheWrite: number; // 缓存写入 token 数
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
```

### 4. Model 结构

```typescript
interface Model<TApi extends string = string> {
  id: string;
  name: string;
  api: TApi;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: {
    input: number;   // 每 1M token 价格
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
}
```

### 5. Context 结构

```typescript
interface Context {
  systemPrompt: string;
  messages: Message[];
}
```

### 6. ThinkingContent 的重要性

ThinkingContent 是一等公民，支持模型展示思考过程：

```typescript
const assistantMsg: AssistantMessage = {
  role: "assistant",
  content: [
    { type: "text", text: "你好！" },
    { type: "thinking", text: "用户说你好，我应该友好回复" },
    { type: "text", text: "有什么可以帮助你的吗？" },
  ],
  // ...
};
```

## 例题

**题目**：创建一个包含多轮对话的消息数组，模拟用户询问天气的过程。

**参考答案**：

```typescript
import type { Message, UserMessage, AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";

const conversation: Message[] = [
  {
    role: "user",
    content: "北京天气怎么样？",
    timestamp: Date.now(),
  } satisfies UserMessage,
  {
    role: "assistant",
    content: [
      { type: "thinking", text: "用户想知道北京天气，我需要调用天气工具" },
      { type: "text", text: "让我查一下北京的天气。" },
      { type: "toolCall", id: "tc-001", name: "getWeather", arguments: { city: "北京" } },
    ],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4o",
    usage: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 70, cost: { input: 0.0001, output: 0.0002, cacheRead: 0, cacheWrite: 0, total: 0.0003 } },
    stopReason: "toolUse",
    timestamp: Date.now(),
  } satisfies AssistantMessage,
  {
    role: "toolResult",
    toolCallId: "tc-001",
    toolName: "getWeather",
    content: [{ type: "text", text: "北京今天25°C，晴天" }],
    isError: false,
    timestamp: Date.now(),
  } satisfies ToolResultMessage,
];
```

## 课后习题

1. 定义一个 `SystemMessage` 类型，并说明为什么它不在 `Message` 联合类型中
2. 创建一个包含 3 轮对话的消息数组，模拟用户使用工具的过程
3. 解释 `Usage` 中 `cacheRead` 和 `cacheWrite` 的作用
