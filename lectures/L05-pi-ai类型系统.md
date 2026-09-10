# L05：pi-ai 类型系统

## 核心教材

- `packages/pi-ai/src/types.ts` — 核心类型定义
- `experiments/L05-pi-ai-types.ts` — 实验代码

## 知识点清单

1. 中立格式的 Message 类型（UserMessage / AssistantMessage / ToolResultMessage）
2. AssistantMessage 的 content 数组结构（TextContent / ThinkingContent / ImageContent / ToolCall）
3. Usage 记账结构
4. 统一事件协议
5. Model 结构
6. Context 结构
7. Tool 类型
8. API 类型与 KnownApi 枚举
9. Provider 类型与 KnownProvider 枚举
10. Transport 传输类型
11. SimpleStreamOptions 流式选项
12. EventStream / AssistantMessageEventStream 事件流封装

## 详细讲解

### 1. Message 类型体系

```typescript
type Message = UserMessage | AssistantMessage | ToolResultMessage;

interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];  // 支持纯文本或图文混合
  timestamp: number;
}

interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: ProviderId;
  model: string;
  responseModel?: string;      // 实际响应模型（如 OpenRouter auto 路由后）
  responseId?: string;         // Provider 响应标识
  diagnostics?: AssistantMessageDiagnostic[];  // 诊断信息
  usage: Usage;
  stopReason: StopReason;
  deferred?: DeferredHandle;   // 异步延迟句柄
  errorMessage?: string;
  rawStopReason?: string;
  endTurn?: boolean;           // Provider 标记的轮次结束标志
  timestamp: number;
}

interface ToolResultMessage<TDetails = any> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];  // 支持文本和图片
  details?: TDetails;
  usage?: Usage;               // 工具执行本身的 usage（不计入 LLM 上下文）
  addedToolNames?: string[];   // 本结果后新增的工具名（用于延迟加载）
  isError: boolean;
  timestamp: number;
}
```

**关键变化**：
- `UserMessage.content` 支持 `string` 或 `(TextContent | ImageContent)[]`，实现图文混合输入
- `AssistantMessage` 新增 `responseModel`、`responseId`、`diagnostics`、`deferred`、`errorMessage`、`rawStopReason`、`endTurn` 等字段
- `ToolResultMessage.content` 支持 `ImageContent`，实现图片返回
- `ToolResultMessage` 新增 `usage`（工具执行开销）和 `addedToolNames`（延迟工具加载）

### 2. ContentBlock 类型

```typescript
type ContentBlock = TextContent | ThinkingContent | ImageContent | ToolCall;

interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;  // OpenAI 签名，用于多轮对话重放
}

interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;  // Provider 特定的推理重放数据
  redacted?: boolean;  // 安全过滤器标记，payload 存于 signature 以便多轮连续性
}

interface ImageContent {
  type: "image";
  data: string;       // base64 编码的图片数据
  mimeType: string;   // 如 "image/jpeg", "image/png"
}

interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string;  // Google 特定：复用思考上下文的签名
  namespace?: string;         // OpenAI Responses 动态工具命名空间
}
```

**关键变化**：
- `ThinkingContent` 的字段从 `text` 改为 `thinking`，并增加了 `thinkingSignature` 用于多轮对话推理重放
- `ImageContent` 是新增的图片内容块，支持多模态输入
- `ToolCall` 增加了 `thoughtSignature`（Google）和 `namespace`（OpenAI Responses）

### 3. Usage 记账结构

```typescript
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;  // Anthropic 特有：1h 保留期的缓存写入（cacheWrite 子集）
  reasoning?: number;      // 推理/思考 token 数（output 的子集，undefined 表示未上报）
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

**关键变化**：
- `cacheWrite1h`：Anthropic 特有的 1 小时保留期缓存写入细分
- `reasoning`：推理 token 细分，是 `output` 的子集。部分 Provider 上报，部分不上报（undefined）

### 4. Model 结构

```typescript
interface Model<TApi extends Api> {
  id: string;
  name: string;
  api: TApi;
  provider: ProviderId;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;  // 思考级别到 Provider 值的映射
  input: ("text" | "image")[];
  cost: ModelCost;
  contextWindow: number;
  maxTokens: number;
  samplingParams?: Record<string, unknown>;  // 默认采样参数
  headers?: Record<string, string>;
  compat?: OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat | BedrockCompat;
}
```

**关键变化**：
- `TApi` 泛型参数约束为 `Api` 而非 `string`
- 新增 `thinkingLevelMap`：思考级别到 Provider 特定值的映射
- 新增 `samplingParams`：默认采样参数
- 新增 `headers`：自定义 HTTP 头
- 新增 `compat`：API 兼容性配置，类型根据 `TApi` 自动推导

### 5. Context 结构

```typescript
interface Context {
  systemPrompt?: string;  // 变为可选
  messages: Message[];
  tools?: Tool[];         // 新增：工具定义列表
}
```

**关键变化**：
- `systemPrompt` 变为可选
- 新增 `tools` 字段，支持工具定义

### 6. ThinkingContent 的重要性

ThinkingContent 是一等公民，支持模型展示思考过程：

```typescript
const assistantMsg: AssistantMessage = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "用户想知道北京天气，我需要调用天气工具" },
    { type: "text", text: "让我查一下北京的天气。" },
    { type: "toolCall", id: "tc-001", name: "getWeather", arguments: { city: "北京" } },
  ],
  // ...
};
```

### 6.1 StopReason 停止原因

```typescript
type StopReason =
  | "pending"    // 流式进行中
  | "stop"       // 正常停止
  | "length"     // 达到 max_tokens
  | "toolUse"    // 需要调用工具
  | "error"      // 发生错误
  | "aborted"    // 被用户中断
  | "deferred";  // 异步延迟完成
```

### 6.2 DeferredHandle 延迟句柄

```typescript
interface DeferredHandle {
  provider: string;
  modelId: string;
  api: string;
  id: string;              // Provider token（如 response_id 或 batch_id）
  expiresAt?: number;
  pollAfterMs?: number;
  data?: JsonValue;        // 重建 AssistantMessage 所需的 Provider 转换数据
}
```

### 7. Tool 类型

```typescript
interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;  // TypeBox schema 定义参数结构
  constrainedSampling?: false | ConstrainedSamplingConfig;
}

type ConstrainedSamplingConfig =
  | { type: "json_schema"; strict: "prefer" | "require" }
  | { type: "grammar"; variants: GrammarVariants };
```

**设计要点**：
- `parameters` 使用 TypeBox 的 `TSchema`，支持运行时类型验证
- `constrainedSampling` 允许 Provider 使用结构化采样（JSON Schema 或 Grammar）来约束工具输出格式
- `AgentTool` 是 `Tool` 的扩展，支持 `instructions` 和 `agent` 字段（本节不展开）

### 8. API 类型

```typescript
type KnownApi =
  | "openai-completions"
  | "mistral-conversations"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-vertex"
  | "pi-messages";

type Api = KnownApi | (string & {});  // 支持自定义 API

type KnownImagesApi = "openrouter-images";
type ImagesApi = KnownImagesApi | (string & {});
```

**设计要点**：
- `(string & {})` 技巧：允许自定义字符串值，同时保持自动补全
- 每个 API 对应一个 `src/api/` 下的实现模块
- `ApiOptionsMap` 将 API 名称映射到具体的 Option 类型

### 9. Provider 类型

```typescript
type KnownProvider =
  | "amazon-bedrock" | "anthropic" | "google" | "openai"
  | "deepseek" | "groq" | "openrouter" | "xai"
  | "minimax" | "moonshotai" | "kimi-coding" | "xiaomi"
  // ... 约 30+ 个已知 Provider
  | string;  // 支持自定义 Provider

type ProviderId = KnownProvider | string;
type KnownImagesProvider = "openrouter";
type ImagesProviderId = KnownImagesProvider | string;
```

**Provider 的核心接口**：

```typescript
interface ProviderStreams {
  stream(model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream;
  streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
  fetchDeferred?(model: Model<Api>, handle: DeferredHandle, options?: DeferredFetchOptions): AssistantMessageEventStream;
  cancelDeferred?(model: Model<Api>, handle: DeferredHandle, options?: DeferredCancelOptions): Promise<void>;
}
```

### 10. Transport 传输类型

```typescript
type Transport = "sse" | "websocket" | "websocket-cached" | "auto";
```

**传输方式说明**：
- `sse`：Server-Sent Events，HTTP 长连接流式传输
- `websocket`：WebSocket 双向通信
- `websocket-cached`：带缓存的 WebSocket
- `auto`：自动选择最佳传输方式

### 11. SimpleStreamOptions 流式选项

```typescript
interface SimpleStreamOptions extends StreamOptions {
  toolChoice?: ToolChoice;        // "auto" | "none"
  reasoning?: ThinkingLevel;      // 思考级别
  deferred?: boolean | { window?: "15m" | "1h" | "24h" };  // 异步延迟请求
  thinkingBudgets?: ThinkingBudgets;  // 思考 token 预算
}

type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ToolChoice = "auto" | "none";

interface StreamOptions extends ProviderRequestOptions<Model<Api>> {
  temperature?: number;
  samplingParams?: Record<string, unknown>;
  maxTokens?: number;
  transport?: Transport;
  cacheRetention?: CacheRetention;  // "none" | "short" | "long"
  sessionId?: string;
  websocketConnectTimeoutMs?: number;
  metadata?: Record<string, unknown>;
}
```

### 12. EventStream 与 AssistantMessageEventStream

`EventStream<T, R>` 是通用的异步事件流封装：

```typescript
class EventStream<T, R = T> implements AsyncIterable<T> {
  push(event: T): void;     // 推送事件
  end(result?: R): void;    // 结束流
  async *[Symbol.asyncIterator](): AsyncIterator<T>;  // 支持 for await
  result(): Promise<R>;     // 获取最终结果
}
```

`AssistantMessageEventStream` 是 `EventStream` 的特化：

```typescript
class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  // 自动识别 done/error 事件作为终止条件
  // result() 返回完整的 AssistantMessage
}
```

**事件协议**：

```typescript
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: StopReason; message: AssistantMessage }
  | { type: "error"; reason: StopReason; error: AssistantMessage };
```

**使用模式**：

```typescript
// 消费事件流
for await (const event of stream) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}

// 等待最终结果
const message = await stream.result();
```

## 例题

**题目**：创建一个包含多轮对话的消息数组，模拟用户询问天气的过程，使用新的 ContentBlock 类型。

**参考答案**：

```typescript
import type { Message, UserMessage, AssistantMessage, ToolResultMessage, ImageContent, TextContent } from "@earendil-works/pi-ai";

// 用户发送图片 + 文字
const userMsg: UserMessage = {
  role: "user",
  content: [
    { type: "text", text: "这张图片里的建筑是什么？" },
    { type: "image", data: "base64...", mimeType: "image/jpeg" },
  ],
  timestamp: Date.now(),
};

const assistantMsg: AssistantMessage = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "用户发送了一张建筑图片，我需要识别它" },
    { type: "text", text: "这是埃菲尔铁塔的照片。" },
  ],
  api: "openai-responses",
  provider: "openai",
  model: "gpt-4o",
  usage: { input: 100, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 130, cost: { input: 0.0002, output: 0.0003, cacheRead: 0, cacheWrite: 0, total: 0.0005 } },
  stopReason: "stop",
  timestamp: Date.now(),
};

const toolResultMsg: ToolResultMessage = {
  role: "toolResult",
  toolCallId: "tc-001",
  toolName: "getWeather",
  content: [{ type: "text", text: "北京今天25°C，晴天" }],
  isError: false,
  timestamp: Date.now(),
};
```

## 课后习题

1. 定义一个 `SystemMessage` 类型，并说明为什么它不在 `Message` 联合类型中
2. 创建一个包含图片输入的 `UserMessage`，模拟用户发送截图并提问
3. 解释 `Usage` 中 `cacheRead`、`cacheWrite` 和 `cacheWrite1h` 的区别
4. 说明 `Tool.constrainedSampling` 的两种模式（`json_schema` 和 `grammar`）分别适用于什么场景
5. 解释 `EventStream` 的 `push()`、`end()` 和 `result()` 三个方法的作用
6. 说明 `Transport` 四种传输方式的适用场景
