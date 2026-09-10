# Pi Agent 实验室

理解 Pi Agent 核心机制的动手实验。

无需 API Key — 所有实验使用假 `StreamFn` 模拟 LLM 行为。

## 快速开始

```bash
# 安装依赖
npm install

# 运行所有实验
npm test

# 运行特定实验
npm run test:1
```

## 你将学到什么

### AgentLoop 实验（L03）

| 实验 | 主题 | 核心概念 |
|------|------|----------|
| 1 | 无工具调用 | 纯文本响应路径 |
| 2 | 两个工具 | 并行执行，完成顺序 vs 声明顺序 |
| 3 | beforeToolCall | 阻止工具执行 |
| 4 | afterToolCall | 重写工具结果 |
| 5 | shouldStopAfterTurn | 执行 N 次工具调用后强制停止 |
| 6 | 链式依赖 | 工具 B 的参数来自工具 A 的结果 |
| 7 | agentLoopContinue | 从现有上下文重试 |
| 8 | 截断 | stopReason="length" → 批量失败 |
| 9 | 顺序 vs 并行 | 执行顺序比较 |
| 10 | getSteeringMessages | 执行中用户中断 |
| 11 | getFollowUpMessages | 排队消息以继续 |
| 12 | prepareNextTurn | 轮次间热切换模型 |

### 课程实验（L02-L10）

| 实验 | 主题 | 核心概念 |
|------|------|----------|
| L02 | AgentTool 接口 | 实现 wordCount 工具 |
| L04 | SimpleAgent 包装器 | 状态机外壳 |
| L05 | pi-ai 类型系统 | 统一多厂商 LLM API |
| L06 | 工具系统五段式 | 工具的完整一生 |
| L07 | append-only 会话树 | 消息系统与树结构 |
| L08 | 上下文压缩算法 | 切割点 + 摘要 |
| L09 | 扩展系统 | 极简内核的无限外挂 |
| L10 | TUI 差分渲染 | 从内核到产品 |

### 毕业设计

**mini-Pi**（`mini-pi/mini-pi.ts`）：约 400 行代码实现：
- ✅ 最小循环（对应 L03）
- ✅ 工具系统（对应 L02/L06）
- ✅ 会话持久化 + 树（对应 L07）
- ✅ 压缩（对应 L08）
- ✅ 流式输出（模拟）

```bash
cd /path/to/pi
npx tsx ../pi-agent-loop-labs/mini-pi/mini-pi.ts
```

## 架构

```
┌─────────────────────────────────────┐
│           agentLoop()               │
│  Entry point for new prompts        │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│         runAgentLoop()              │
│  Emit agent_start, turn_start       │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│              runLoop()              │
│  Main loop with inner/outer while   │
└──┬──────────────────────────────┬──┘
   │                              │
┌──▼─────────────────────┐ ┌──────▼─────────────────────┐
│   Inner while loop     │ │   Outer while loop         │
│   hasMoreToolCalls ||  │ │   Check followUpMessages   │
│   pendingMessages      │ │   or break                 │
└──┬─────────────────────┘ └────────────────────────────┘
   │
┌──▼─────────────────────┐
│  streamAssistantResponse│
│  LLM call + streaming  │
└──┬─────────────────────┘
   │
┌──▼─────────────────────┐
│  executeToolCalls       │
│  Sequential or Parallel│
└──┬─────────────────────┘
   │
┌──▼─────────────────────┐
│  Hooks                  │
│  ├─ beforeToolCall      │
│  ├─ afterToolCall       │
│  ├─ shouldStopAfterTurn │
│  ├─ prepareNextTurn     │
│  ├─ getSteeringMessages │
│  └─ getFollowUpMessages │
└────────────────────────┘
```

## 项目结构

```
pi-agent-loop-labs/
├── src/
│   ├── pi-ai.ts          # Minimal type shim
│   ├── types.ts           # AgentLoopConfig, AgentEvent, AgentTool
│   └── agent-loop.ts      # Core loop
├── experiments/
│   ├── experiment-1-12    # L03 实验
│   ├── L02-L10            # 课程实验
│   └── run-all.ts         # 批量运行器
├── mini-pi/
│   └── mini-pi.ts         # 毕业设计
├── package.json
└── README.md
```

## 工作原理

每个实验创建 `MockAssistantStream` 推送假 LLM 响应，然后作为 `streamFn` 传给 `agentLoop()`。这样你可以观察精确的事件序列和消息流，无需调用真实 LLM。

```typescript
import { agentLoop } from "../src/agent-loop.ts";

const stream = agentLoop(
  [userPrompt],
  context,
  config,
  undefined,
  fakeStreamFn,  // Your mock LLM
);

for await (const event of stream) {
  console.log(`Event: ${event.type}`);
}

const messages = await stream.result();
```

## 基于

源代码来自 [pi-agent](https://github.com/earendil-works/pi-mono) `packages/agent/src/agent-loop.ts`。

## License

MIT
