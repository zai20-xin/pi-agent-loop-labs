# L04：Agent 包装器实现

## 核心教材

- `packages/agent/src/agent-loop.ts` — agentLoop 函数
- `experiments/L04-agent-wrapper.ts` — 实验代码

## 知识点清单

1. 纯函数引擎 + 有状态外壳的设计模式
2. prompt / subscribe / abort 三个核心方法
3. AgentContext 与 AgentLoopConfig
4. 事件订阅与状态管理
5. 并发保护机制
6. Mock 模拟基础设施

## 详细讲解

### 1. 纯函数引擎 + 有状态外壳

```
┌─────────────────────────────────────┐
│         SimpleAgent (有状态)          │
│  ┌─────────────────────────────┐   │
│  │      agentLoop (纯函数)       │   │
│  │  输入: messages + context     │   │
│  │  输出: events stream         │   │
│  └─────────────────────────────┘   │
│  - _state (状态)                    │
│  - listeners (事件监听器)           │
│  - abortController (中断控制器)    │
└─────────────────────────────────────┘
```

### 2. 三个核心方法

```typescript
class SimpleAgent {
  // 发送用户输入，触发 agentLoop
  async prompt(input: string): Promise<void>

  // 订阅事件流
  subscribe(listener: EventListener): () => void

  // 中断当前处理
  abort(): void
}
```

### 3. AgentContext 结构

```typescript
interface AgentContext {
  systemPrompt: string;   // 系统提示词
  messages: AgentMessage[];  // 历史消息
  tools: AgentTool[];     // 可用工具
}
```

### 4. AgentLoopConfig 结构

```typescript
interface AgentLoopConfig {
  model: Model<any>;      // 模型配置
  convertToLlm: (messages: AgentMessage[]) => Message[];  // 消息转换
}
```

### 5. 事件处理流程

```typescript
for await (const event of stream) {
  await this.processEvent(event);
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
```

### 6. 并发保护

```typescript
async prompt(input: string): Promise<void> {
  if (this._state.isStreaming) {
    throw new Error("Agent is already processing. Wait for completion.");
  }
  // ...
}
```

## 例题

**题目**：扩展 SimpleAgent，添加以下功能：
1. 支持配置系统提示词
2. 支持动态添加工具
3. 支持获取当前状态

**参考答案**：

```typescript
class ExtendedAgent extends SimpleAgent {
  private _tools: AgentTool[] = [];

  constructor(options: SimpleAgentOptions = {}) {
    super(options);
    this._tools = options.tools ?? [];
  }

  // 动态添加工具
  addTool(tool: AgentTool): void {
    this._tools.push(tool);
  }

  // 获取当前状态
  getStatus(): {
    isStreaming: boolean;
    messageCount: number;
    toolCount: number;
  } {
    return {
      isStreaming: this.state.isStreaming,
      messageCount: this.state.messages.length,
      toolCount: this._tools.length,
    };
  }

  // 获取完整状态
  getFullState() {
    return {
      ...this.state,
      tools: this._tools,
    };
  }
}
```

## 课后习题

1. 实现一个支持重试机制的 Agent 包装器
2. 添加消息持久化功能，将对话历史保存到文件
3. 实现工具调用统计功能，记录每个工具的调用次数
