# pi-agent-loop-labs

Hands-on experiments for understanding the core agent loop in pi-agent.

No API keys needed — all experiments use fake `StreamFn` to simulate LLM behavior.

## Quick Start

```bash
# Install dependencies
npm install

# Run all experiments
npm test

# Run a specific experiment
npm run test:1
```

## What You'll Learn

| Experiment | Topic | Key Concept |
|------------|-------|-------------|
| 1 | No tool call | Text-only response path |
| 2 | Two tools | Parallel execution, completion order vs declaration order |
| 3 | beforeToolCall | Block tool execution |
| 4 | afterToolCall | Rewrite tool results |
| 5 | shouldStopAfterTurn | Force stop after N tool calls |
| 6 | Chain dependency | Tool B's params come from Tool A's result |
| 7 | agentLoopContinue | Retry from existing context |
| 8 | Truncation | stopReason="length" → batch fail |
| 9 | Sequential vs Parallel | Execution order comparison |
| 10 | getSteeringMessages | User interruption mid-execution |
| 11 | getFollowUpMessages | Queue messages for continuation |
| 12 | prepareNextTurn | Hot-swap model between turns |

## Architecture

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
               ┌───────────────────▼───────────────────┐
               │              runLoop()                │
               │  Main loop with inner/outer while     │
               └──┬────────────────────────────────┬──┘
                  │                                │
    ┌─────────────▼─────────────┐    ┌─────────────▼─────────────┐
    │   Inner while loop        │    │   Outer while loop        │
    │   hasMoreToolCalls ||     │    │   Check followUpMessages  │
    │   pendingMessages.length  │    │   or break                │
    └─────────────┬─────────────┘    └───────────────────────────┘
                  │
    ┌─────────────▼─────────────┐
    │  streamAssistantResponse  │
    │  LLM call + streaming     │
    └─────────────┬─────────────┘
                  │
    ┌─────────────▼─────────────┐
    │  executeToolCalls         │
    │  Sequential or Parallel   │
    └─────────────┬─────────────┘
                  │
    ┌─────────────▼─────────────┐
    │  Hooks                    │
    │  ├─ beforeToolCall        │
    │  ├─ afterToolCall         │
    │  ├─ shouldStopAfterTurn   │
    │  ├─ prepareNextTurn       │
    │  ├─ getSteeringMessages   │
    │  └─ getFollowUpMessages   │
    └───────────────────────────┘
```

## Project Structure

```
pi-agent-loop-labs/
├── src/
│   ├── pi-ai.ts          # Minimal type shim (EventStream, AssistantMessage, etc.)
│   ├── types.ts           # AgentLoopConfig, AgentEvent, AgentTool, etc.
│   └── agent-loop.ts      # Core loop (agentLoop, runLoop, executeToolCalls)
├── experiments/
│   ├── experiment-1-*.ts
│   ├── ...
│   ├── experiment-12-*.ts
│   └── run-all.ts         # Batch runner
├── package.json
└── README.md
```

## How It Works

Each experiment creates a `MockAssistantStream` that pushes fake LLM responses, then passes it as `streamFn` to `agentLoop()`. This lets you observe the exact event sequence and message flow without calling a real LLM.

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

## Based On

Source code from [pi-agent](https://github.com/earendil-works/pi-mono) `packages/agent/src/agent-loop.ts`.

## License

MIT
