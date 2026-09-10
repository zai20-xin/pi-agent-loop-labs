# L04：Agent 包装器实现

## 核心教材

- `packages/agent/src/agent-loop.ts` — agentLoop 函数
- `packages/agent/src/agent.ts` — 完整 Agent 类（592行）
- `experiments/L04-agent-wrapper.ts` — 实验代码

## 知识点清单

1. 纯函数引擎 + 有状态外壳的设计模式
2. prompt / continue / abort 核心方法
3. 消息队列系统（steering & follow-up）
4. AgentContext 与 AgentLoopConfig
5. 事件订阅与状态管理
6. 生命周期钩子（beforeToolCall / afterToolCall / shouldStopAfterTurn）
7. 并发保护与运行状态控制
8. 传输层配置（transport / thinkingBudgets / toolExecution）
9. PendingMessageQueue 内部实现
10. Mock 模拟基础设施

## 详细讲解

### 1. 纯函数引擎 + 有状态外壳

```
┌─────────────────────────────────────────────────┐
│              Agent (有状态外壳)                    │
│  ┌───────────────────────────────────────────┐  │
│  │           agentLoop (纯函数引擎)            │  │
│  │  输入: messages + context + config          │  │
│  │  输出: AsyncIterable<AgentEvent>            │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
│  状态层:                                         │
│  - _state (messages, tools, systemPrompt)       │
│  - listeners (事件监听器集合)                     │
│  - activeRun (当前运行控制)                      │
│                                                  │
│  队列层:                                         │
│  - steeringQueue (插话消息队列)                  │
│  - followUpQueue (追加消息队列)                  │
└─────────────────────────────────────────────────┘
```

### 2. 核心方法一览

```typescript
class Agent {
  // === 启动与继续 ===
  async prompt(input: string | AgentMessage | AgentMessage[]): Promise<void>
  async continue(): Promise<void>  // 从当前上下文继续

  // === 队列注入 ===
  steer(message: AgentMessage): void      // 注入插话消息
  followUp(message: AgentMessage): void   // 注入追加消息

  // === 队列管理 ===
  clearSteeringQueue(): void
  clearFollowUpQueue(): void
  clearAllQueues(): void
  hasQueuedMessages(): boolean

  // === 生命周期 ===
  subscribe(listener: EventListener): () => void
  abort(): void
  waitForIdle(): Promise<void>
  reset(): void

  // === 状态查询 ===
  get state(): AgentState
  get signal(): AbortSignal | undefined
}
```

### 3. 消息队列系统

#### PendingMessageQueue 内部实现

```typescript
class PendingMessageQueue {
  private messages: AgentMessage[] = [];
  public mode: QueueMode;  // "one-at-a-time" | "all"

  enqueue(message: AgentMessage): void {
    this.messages.push(message);
  }

  // 根据模式取出消息
  drain(): AgentMessage[] {
    if (this.mode === "all") {
      // 取出所有排队消息
      const drained = this.messages.slice();
      this.messages = [];
      return drained;
    }
    // "one-at-a-time" 模式：只取第一条
    const first = this.messages[0];
    if (!first) return [];
    this.messages = this.messages.slice(1);
    return [first];
  }

  hasItems(): boolean {
    return this.messages.length > 0;
  }

  clear(): void {
    this.messages = [];
  }
}
```

#### 队列注入机制

```
用户调用 steer() / followUp()
         │
         ▼
┌─────────────────────┐
│  PendingMessageQueue │
│  (内部缓冲数组)      │
└─────────────────────┘
         │
         ▼
agentLoop 每轮结束后轮询
         │
         ▼
┌─────────────────────┐
│  getSteeringMessages │  ← 当前轮结束后
│  getFollowUpMessages │  ← Agent 准备停止时
└─────────────────────┘
```

### 4. AgentContext 与 AgentLoopConfig

#### AgentContext（上下文快照）

```typescript
interface AgentContext {
  systemPrompt: string;      // 系统提示词
  messages: AgentMessage[];  // 历史消息（只读快照）
  tools: AgentTool[];        // 可用工具（只读快照）
}
```

#### AgentLoopConfig（完整配置）

```typescript
interface AgentLoopConfig {
  // 模型配置
  model: Model<any>;
  reasoning?: "off" | "low" | "medium" | "high";
  sessionId?: string;
  thinkingBudgets?: ThinkingBudgets;
  transport?: Transport;
  maxRetryDelayMs?: number;
  toolExecution?: ToolExecutionMode;

  // 消息转换
  convertToLlm: (messages: AgentMessage[]) => Message[];
  transformContext?: (messages: AgentMessage[]) => Promise<AgentMessage[]>;

  // 钩子函数
  beforeToolCall?: BeforeToolCallFn;
  afterToolCall?: AfterToolCallFn;
  shouldStopAfterTurn?: ShouldStopAfterTurnFn;
  prepareNextTurn?: PrepareNextTurnFn;

  // 队列轮询
  getSteeringMessages: () => Promise<AgentMessage[]>;
  getFollowUpMessages: () => Promise<AgentMessage[]>;

  // API 密钥
  getApiKey?: (provider: string) => Promise<string | undefined>;
}
```

### 5. 事件处理流程（完整）

```typescript
private async processEvents(event: AgentEvent): Promise<void> {
  switch (event.type) {
    case "message_start":
      this._state.streamingMessage = event.message;
      break;

    case "message_update":
      this._state.streamingMessage = event.message;
      break;

    case "message_end":
      this._state.streamingMessage = undefined;
      this._state.messages.push(event.message);  // 持久化消息
      break;

    case "tool_execution_start":
      this._state.pendingToolCalls.add(event.toolCallId);
      break;

    case "tool_execution_end":
      this._state.pendingToolCalls.delete(event.toolCallId);
      break;

    case "turn_end":
      if (event.message.errorMessage) {
        this._state.errorMessage = event.message.errorMessage;
      }
      break;

    case "agent_end":
      this._state.streamingMessage = undefined;
      break;
  }

  // 通知所有订阅者
  for (const listener of this.listeners) {
    await listener(event, this.signal);
  }
}
```

### 6. 生命周期钩子

```typescript
// 工具执行前拦截
beforeToolCall?: (context: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined>;
// 返回 { skip: true } 跳过执行
// 返回 { result: "..." } 替换执行结果

// 工具执行后处理
afterToolCall?: (context: AfterToolCallContext) => Promise<AfterToolCallResult | undefined>;
// 可修改工具执行结果

// 每轮结束后决定是否停止
shouldStopAfterTurn?: (context: ShouldStopAfterTurnContext) => boolean | Promise<boolean>;

// 准备下一轮（可注入额外消息）
prepareNextTurn?: () => Promise<AgentLoopTurnUpdate | undefined>;
```

### 7. 并发保护与运行状态控制

```typescript
// 运行状态追踪
private activeRun?: ActiveRun;

type ActiveRun = {
  promise: Promise<void>;      // 运行完成的 Promise
  resolve: () => void;         // 手动 resolve
  abortController: AbortController;
};

// 并发保护：prompt
async prompt(input: string): Promise<void> {
  if (this.activeRun) {
    throw new Error(
      "Agent is already processing a prompt. Use steer() or followUp() to queue messages."
    );
  }
  // ...
}

// 继续运行：continue
async continue(): Promise<void> {
  if (this.activeRun) {
    throw new Error("Agent is already processing.");
  }
  // 检查最后一条消息类型
  const lastMessage = this._state.messages.at(-1);
  if (lastMessage?.role === "assistant") {
    // 先处理队列中的消息
    const queuedSteering = this.steeringQueue.drain();
    if (queuedSteering.length > 0) {
      await this.runPromptMessages(queuedSteering);
      return;
    }
  }
  // 正常继续
  await this.runContinuation();
}

// 等待运行完成
waitForIdle(): Promise<void> {
  return this.activeRun?.promise ?? Promise.resolve();
}

// 重置状态（必须在非运行状态）
reset(): void {
  if (this.activeRun) {
    throw new Error("Agent is already processing. Wait for completion.");
  }
  this._state.messages = [];
  this._state.isStreaming = false;
  this._state.streamingMessage = undefined;
  this._state.pendingToolCalls = new Set();
  this._state.errorMessage = undefined;
  this.clearAllQueues();
}
```

### 8. 传输层配置

```typescript
// 传输方式
transport: Transport;  // 默认 "auto"

// 思考级别（extended thinking）
thinkingLevel: "off" | "low" | "medium" | "high";
thinkingBudgets?: ThinkingBudgets;  // 每个级别的 token 预算

// 工具执行模式
toolExecution: ToolExecutionMode;  // "parallel" | "sequential"
// parallel: 助手消息中的多个工具调用并行执行
// sequential: 顺序执行

// 重试延迟上限
maxRetryDelayMs?: number;
```

### 9. 运行生命周期

```
prompt() / continue()
        │
        ▼
┌─────────────────────────────────────┐
│  runWithLifecycle()                  │
│  1. 创建 AbortController             │
│  2. 设置 isStreaming = true          │
│  3. 清除 streamingMessage            │
│  4. 执行 agentLoop                   │
│  5. 处理错误 → handleRunFailure()    │
│  6. 清理 → finishRun()               │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  事件流: message_start → message_end │
│           ↓                          │
│  tool_execution_start → tool_end     │
│           ↓                          │
│  turn_end → agent_end                │
└─────────────────────────────────────┘
```

## 例题

**题目**：实现一个支持消息队列注入的 Agent 包装器，要求：
1. 支持在 Agent 运行时插入 "steering" 消息
2. 支持配置队列模式（one-at-a-time / all）
3. 支持清除队列和查询队列状态

**参考答案**：

```typescript
class QueueAwareAgent extends Agent {
  constructor(options: AgentOptions) {
    super({
      ...options,
      steeringMode: options.steeringMode ?? "one-at-a-time",
      followUpMode: options.followUpMode ?? "one-at-a-time",
    });
  }

  // 注入插话消息
  injectSteeringMessage(text: string): void {
    this.steer({
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    });
  }

  // 注入追加消息
  injectFollowUp(text: string): void {
    this.followUp({
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    });
  }

  // 批量注入消息
  injectBatch(messages: Array<{ text: string; type: "steering" | "followUp" }>): void {
    for (const msg of messages) {
      if (msg.type === "steering") {
        this.injectSteeringMessage(msg.text);
      } else {
        this.injectFollowUp(msg.text);
      }
    }
  }

  // 查询队列状态
  getQueueStatus(): {
    hasPending: boolean;
    steeringMode: QueueMode;
    followUpMode: QueueMode;
  } {
    return {
      hasPending: this.hasQueuedMessages(),
      steeringMode: this.steeringMode,
      followUpMode: this.followUpMode,
    };
  }

  // 清空指定队列
  clearQueue(type: "steering" | "followUp" | "all"): void {
    switch (type) {
      case "steering":
        this.clearSteeringQueue();
        break;
      case "followUp":
        this.clearFollowUpQueue();
        break;
      case "all":
        this.clearAllQueues();
        break;
    }
  }
}

// 使用示例
const agent = new QueueAwareAgent({
  streamFn: mockStreamFn,
  steeringMode: "one-at-a-time",
  followUpMode: "all",
});

// 启动对话
await agent.prompt("Hello");

// 在运行时注入消息
agent.injectSteeringMessage("Actually, use Python instead");
agent.injectFollowUp("And also explain the error handling");

// 检查队列状态
console.log(agent.getQueueStatus());
// { hasPending: true, steeringMode: "one-at-a-time", followUpMode: "all" }
```

## 课后习题

1. 实现一个支持 beforeToolCall 钩子的 Agent，记录所有工具调用日志
2. 使用 shouldStopAfterTurn 实现对话轮次限制（最多 10 轮）
3. 实现一个带有 session 恢复功能的 Agent（利用 sessionId 和 reset）
4. 实现一个工具调用统计功能，记录每个工具的调用次数和耗时
