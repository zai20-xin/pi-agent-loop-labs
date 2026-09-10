# L03 AgentLoop 主循环

## 讲次标题
**Agent Loop 主循环：思考 → 行动 → 观察 → 思考**

## 核心教材
- `pi/src/agent-loop.ts` — agentLoop / agentLoopContinue 核心实现
- `pi/src/types.ts` — AgentLoopConfig、AgentEvent、AgentContext 类型定义
- `pi/src/pi-ai.ts` — Message、Model、EventStream 基础类型

## 知识点清单

| 编号 | 知识点 | 实验编号 | 难度 |
|------|--------|----------|------|
| 1 | agentLoop 基础：无工具直接返回 | L03-01 | ⭐ |
| 2 | 双工具并行调用 | L03-02 | ⭐⭐ |
| 3 | beforeToolCall 拦截钩子 | L03-03 | ⭐⭐ |
| 4 | afterToolCall 结果改写钩子 | L03-04 | ⭐⭐ |
| 5 | shouldStopAfterTurn 终止控制 | L03-05 | ⭐⭐⭐ |
| 6 | 链式依赖：工具间结果传递 | L03-06 | ⭐⭐⭐ |
| 7 | agentLoopContinue 续跑 | L03-07 | ⭐⭐ |
| 8 | 截断作废（stopReason=length） | L03-08 | ⭐⭐⭐ |
| 9 | 顺序 vs 并行执行模式 | L03-09 | ⭐⭐⭐ |
| 10 | getSteeringMessages 插话机制 | L03-10 | ⭐⭐⭐⭐ |
| 11 | getFollowUpMessages 追加消息 | L03-11 | ⭐⭐⭐ |
| 12 | prepareNextTurn 热切换模型 | L03-12 | ⭐⭐⭐⭐ |

---

## 详细讲解

### 一、Agent Loop 的核心思想

Agent Loop 本质上是一个 **LLM 驱动的 while 循环**：

```
while (true) {
    1. 调用 LLM，获取响应
    2. 如果响应是文本 → 返回给用户，结束
    3. 如果响应包含 toolCall → 执行工具，拿到结果
    4. 把 toolCall + toolResult 追加到上下文
    5. 回到步骤 1
}
```

**关键洞察**：LLM 决定何时停止。框架只是忠实地执行 LLM 的决策。

---

### 二、12 个实验逐题精讲

#### 实验 1：无工具直接返回（L03-01）

**场景**：用户问"北京天气怎么样？"，LLM 直接返回文本，不调工具。

```
用户提问 → LLM → "北京今天25°C，晴天" → 结束
```

**事件序列**：
1. `turn_start` — 开始一轮
2. `message_start` — 新消息开始
3. `message_end` — 消息结束
4. `turn_end` — 本轮结束

**关键点**：
- 无 `tool_execution_start/end` 事件
- 总共 8 个事件、2 条消息、1 轮
- 这是最简单的 agent 循环路径

---

#### 实验 2：双工具并行调用（L03-02）

**场景**：LLM 一次返回两个 toolCall，框架并行执行。

```
用户："北京天气？翻译成英文"
LLM → [getWeather("北京"), translate("晴天", "English")]
工具并行执行 → 返回结果
LLM → "北京今天25°C，sunny！"
```

**事件序列**：
1. `tool_execution_start` (getWeather)
2. `tool_execution_start` (translate)
3. `tool_execution_end` (getWeather) — 注意：不一定按 start 顺序
4. `tool_execution_end` (translate)
5. `tool_execution_end` — 结果按声明序排列

**关键点**：
- 两个工具**并行执行**（Promise.all）
- `end` 事件按**完成序**（谁先完成谁先 end）
- 结果按**声明序**排列（与 toolCall 数组顺序一致）

---

#### 实验 3：beforeToolCall 拦截（L03-03）

**场景**：框架在执行工具前拦截，禁止调用 getWeather。

```typescript
beforeToolCall: async (ctx) => {
    if (ctx.toolCall.name === "getWeather") {
        return { block: true, reason: "权限不足" };
    }
    return undefined;  // 放行
}
```

**执行流程**：
1. LLM 返回 [getWeather, translate]
2. 框架对每个 toolCall 调用 `beforeToolCall`
3. getWeather 被拦截 → 自动返回 `isError=true` 的错误结果
4. translate 正常执行
5. LLM 看到错误结果，调整回复

**关键点**：
- 拦截不抛异常，而是生成 **error result**
- LLM 能看到"权限不足"的错误信息
- 用途：权限控制、成本控制、安全审计

---

#### 实验 4：afterToolCall 结果改写（L03-04）

**场景**：工具返回原始结果后，框架在返回给 LLM 前改写。

```typescript
afterToolCall: async (ctx) => {
    // 给 content 加审计日志
    // 把 details 里的温度转成 Fahrenheit
    return { content: newContent, details: newDetails };
}
```

**执行流程**：
1. 工具执行返回 `25°C`
2. `afterToolCall` 改写：
   - content 加上审计日志
   - details 加上 Fahrenheit 转换值
3. LLM 看到的是改写后的内容

**关键点**：
- 框架不直接执行工具，而是有**拦截层**
- 可以同时改写 `content`（给 LLM 看）和 `details`（给 UI 看）
- 用途：数据脱敏、格式转换、审计日志

---

#### 实验 5：shouldStopAfterTurn 终止控制（L03-05）

**场景**：每轮结束后检查，累计工具调用 ≥2 次就强制停止。

```typescript
shouldStopAfterTurn: async (ctx) => {
    toolCallCount += ctx.toolResults.length;
    return toolCallCount >= 2;  // true = 停止
}
```

**执行流程**：
1. 第 1 轮：getWeather 执行，累计=1，继续
2. 第 2 轮：translate 执行，累计=2，触发停止
3. **第 3 次 LLM 调用不会发生**

**关键点**：
- 框架**强制中断**循环，不等 LLM 决定
- 用途：防止无限循环、控制成本、设置超时
- 与 `stopReason` 的区别：`stopReason` 由 LLM 决定，`shouldStopAfterTurn` 由框架决定

---

#### 实验 6：链式依赖（L03-06）⭐ 核心实验

**场景**：工具 B 依赖工具 A 的结果。这是真实 agent 的**核心模式**。

```
第 1 轮：LLM 调 getWeather("北京") → 得到 "25°C，晴天"
第 2 轮：LLM 看到天气结果，调 getAdvice("25°C，晴天") → 得到建议
第 3 轮：LLM 拿到综合信息，回复用户
```

**消息链**：
```
[user] "北京天气怎么样？适合跑步吗？"
[assistant] 调用 getWeather({city: "北京"})
[toolResult] getWeather → "北京今天25°C，晴天"
[assistant] 调用 getAdvice({weatherInfo: "25°C，晴天"})  ← 参数来自上一轮结果！
[toolResult] getAdvice → "天气很好，适合户外跑步！"
[assistant] "北京今天25°C，晴天。天气很好，适合户外跑步！"
```

**关键点**：
- **LLM 决定调什么工具、传什么参数**
- getAdvice 的参数 `weatherInfo` 来自 getWeather 的返回值
- 这就是"思考 → 行动 → 观察 → 思考"循环
- 每轮的工具选择和参数都由 LLM **动态决定**

---

#### 实验 7：agentLoopContinue 续跑（L03-07）

**场景**：上下文已有消息，不加新 prompt 直接续跑（重试场景）。

```typescript
// agentLoop：传入新消息
const stream = agentLoop([userPrompt], context, config, ...);

// agentLoopContinue：不加新消息，直接续跑
const stream = agentLoopContinue(context, config, ...);
```

**前置校验**：
1. 上下文非空
2. 最后一条消息**不能是 assistant**（否则 LLM API 会拒绝）

**关键点**：
- 适用于**重试**场景（上一轮工具失败，需要重新执行）
- 不改变上下文，只是让 LLM 从当前状态继续

---

#### 实验 8：截断作废（L03-08）

**场景**：LLM 输出被 token 上限截断，工具调用参数可能不完整。

```
LLM → toolCall + stopReason="length"（截断！）
框架 → 不执行工具，自动生成 isError=true 的错误结果
LLM → 看到错误，重新发起完整调用
```

**框架行为**：
1. 检测到 `stopReason="length"`
2. **不执行**任何工具
3. 为每个 toolCall 生成 `isError=true` 的 error result
4. 错误信息提示"参数可能被截断，请重新发起"

**关键点**：
- **宁可让模型重来，不可带着残缺参数执行**
- 这是框架的**防线 1**：防止不完整命令执行
- 用途：防止 `rm -rf /` 被截断成 `rm -rf /` 导致灾难

---

#### 实验 9：顺序 vs 并行执行（L03-09）

**场景**：同一个 LLM 返回两个 toolCall，对比两种执行模式。

| 特性 | parallel（并行） | sequential（顺序） |
|------|-----------------|-------------------|
| start 顺序 | 两个 start 连续 | start → end → start → end |
| end 顺序 | 按完成序（快的先） | 严格按声明序 |
| 总耗时 | ≈ max(slow, fast) | ≈ slow + fast |
| 适用场景 | 独立工具 | 有依赖的工具 |

**配置**：
```typescript
const config: AgentLoopConfig = {
    toolExecution: "parallel"  // 或 "sequential"
};
```

**关键点**：
- 并行模式：两个工具同时启动，谁先完成谁先 end
- 顺序模式：一个工具**完全执行完**才开始下一个
- 默认是 **parallel**（性能优先）

---

#### 实验 10：getSteeringMessages 插话（L03-10）

**场景**：agent 执行工具期间，用户说"别删那个文件"。

```
第 1 轮：LLM 调 exec("rm -rf /tmp/old") → 工具执行中...
用户插话："别删那个文件！"
工具执行完毕 → 结果回填
轮询 getSteeringMessages → 取到插话
第 2 轮：LLM 看到插话，回复"好的，我不删了"
```

**关键点**：
- 插话**不打断**已开始的工作（工具继续执行）
- 插话**必然影响**下一轮决策
- 插话注入时机：工具结果回填后，下一轮开始前
- 用途：紧急停止、用户追加指示、实时干预

---

#### 实验 11：getFollowUpMessages 追加消息（L03-11）

**场景**：agent 回复完第一个问题后，发现还有排队消息。

```
第 1 轮：LLM 回复"北京今天25°C，晴天"
agent 本来要停 → getFollowUpMessages 返回"上海呢？"
第 2 轮：LLM 回复"上海今天28°C，多云"
```

**与插话的区别**：

| 特性 | 插话 (Steering) | 追加 (Follow-up) |
|------|----------------|-----------------|
| 注入时机 | 工具执行期间 | 本轮结束后 |
| 打断当前 | 不打断 | 不打断 |
| 影响 | 改变下一轮行为 | 续命继续跑 |
| 用途 | 用户干预 | 批量任务排队 |

---

#### 实验 12：prepareNextTurn 热切换模型（L03-12）

**场景**：第 1 轮用便宜模型，第 2 轮切换到贵模型。

```typescript
prepareNextTurn: async (ctx) => {
    if (currentModelId === "gpt-4o") {
        return { model: modelO1 };  // 切换到 o1
    }
    return undefined;  // 不切换
}
```

**执行流程**：
1. 第 1 轮：用 gpt-4o 回复简单问题
2. `prepareNextTurn` 切换到 o1
3. 第 2 轮：用 o1 回复复杂问题

**关键点**：
- 在 `turn_end` 后、下一轮开始前执行
- 可以切换：模型、系统提示、工具集、上下文
- 用途：简单问题用便宜模型，复杂问题切贵模型

---

### 三、Agent Loop 完整流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    agentLoop 主循环                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐                                           │
│  │ turn_start  │                                           │
│  └──────┬──────┘                                           │
│         ▼                                                  │
│  ┌─────────────┐    ┌──────────────┐                       │
│  │ 调用 LLM    │───▶│ message      │                       │
│  └──────┬──────┘    └──────┬───────┘                       │
│         ▼                  ▼                               │
│  ┌─────────────┐    ┌──────────────┐                       │
│  │ stopReason? │    │ toolCall?    │                       │
│  └──────┬──────┘    └──────┬───────┘                       │
│         │                  │                               │
│    "stop"            "toolUse"                             │
│         │                  │                               │
│         ▼                  ▼                               │
│  ┌─────────────┐    ┌──────────────┐                       │
│  │ turn_end    │    │ beforeTool   │                       │
│  │ → 返回文本  │    │ Call 拦截    │                       │
│  └──────┬──────┘    └──────┬───────┘                       │
│         │                  │                               │
│         │            ┌─────▼─────┐                         │
│         │            │ 执行工具  │                         │
│         │            └─────┬─────┘                         │
│         │                  │                               │
│         │            ┌─────▼─────┐                         │
│         │            │ afterTool │                         │
│         │            │ Call 改写 │                         │
│         │            └─────┬─────┘                         │
│         │                  │                               │
│         │            ┌─────▼─────┐                         │
│         │            │ 结果回填  │                         │
│         │            │ 插话注入  │                         │
│         │            └─────┬─────┘                         │
│         │                  │                               │
│         │            ┌─────▼─────┐                         │
│         │            │ shouldStop│                         │
│         │            │ AfterTurn │                         │
│         │            └─────┬─────┘                         │
│         │                  │                               │
│         │            ┌─────▼─────┐                         │
│         │            │ prepare   │                         │
│         │            │ NextTurn  │                         │
│         │            └─────┬─────┘                         │
│         │                  │                               │
│         │            ┌─────▼─────┐                         │
│         │            │ getFollow │                         │
│         │            │ UpMessages│                         │
│         │            └─────┬─────┘                         │
│         │                  │                               │
│         │            ┌─────▼─────┐                         │
│         └───────────▶│ 回到循环  │                         │
│                      └───────────┘                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 四、AgentLoopConfig 钩子总览

| 钩子 | 触发时机 | 用途 | 实验 |
|------|----------|------|------|
| `beforeToolCall` | 工具执行前 | 拦截、权限控制 | L03-03 |
| `afterToolCall` | 工具执行后 | 结果改写、脱敏 | L03-04 |
| `shouldStopAfterTurn` | 每轮结束后 | 强制终止、成本控制 | L03-05 |
| `prepareNextTurn` | 下一轮开始前 | 热切换模型/上下文 | L03-12 |
| `getSteeringMessages` | 工具执行期间 | 用户插话干预 | L03-10 |
| `getFollowUpMessages` | 本轮结束后 | 追加消息续命 | L03-11 |

---

## 例题

### 例题 1：事件计数

**题目**：用户问"北京天气？翻译成英文"，LLM 第 1 次返回两个 toolCall，第 2 次返回最终文本。请列出所有事件。

**答案**：
```
1. turn_start
2. message_start
3. message_end
4. tool_execution_start (getWeather)
5. tool_execution_start (translate)
6. tool_execution_end (getWeather)
7. tool_execution_end (translate)
8. tool_execution_end
9. message_start
10. message_end
11. turn_end
```

---

### 例题 2：链式依赖追踪

**题目**：工具 A 返回 `{city: "北京", temp: 25}`，工具 B 的参数是 `weatherInfo`。请问工具 B 的 `weatherInfo` 从哪来？

**答案**：
- 来自 LLM 的 toolCall 参数
- LLM 在上一轮看到了工具 A 的结果
- LLM 自己决定传什么参数给工具 B
- 框架不负责参数传递，只负责执行和回填

---

### 例题 3：拦截与改写

**题目**：写一个 `beforeToolCall`，拦截所有 `exec` 工具调用，返回"安全模式下禁止执行命令"。

**答案**：
```typescript
beforeToolCall: async (ctx) => {
    if (ctx.toolCall.name === "exec") {
        return { block: true, reason: "安全模式下禁止执行命令" };
    }
    return undefined;
}
```

---

### 例题 4：成本控制

**题目**：写一个 `shouldStopAfterTurn`，如果累计 token 消耗超过 10000 就停止。

**答案**：
```typescript
shouldStopAfterTurn: async (ctx) => {
    const totalTokens = ctx.toolResults.reduce((sum, r) => {
        return sum + (r.usage?.totalTokens ?? 0);
    }, 0);
    return totalTokens > 10000;
}
```

---

### 例题 5：热切换模型

**题目**：第 1 轮用 gpt-4o，如果用户问题超过 100 字，第 2 轮切换到 o1。

**答案**：
```typescript
prepareNextTurn: async (ctx) => {
    const lastUserMsg = ctx.messages.findLast(m => m.role === "user");
    if (lastUserMsg && lastUserMsg.content.length > 100) {
        return { model: modelO1 };
    }
    return undefined;
}
```

---

## 课后习题

### 习题 1（基础）
修改 L03-01，让 LLM 返回时包含一个 toolCall（但不执行），观察事件变化。

### 习题 2（进阶）
修改 L03-03，实现一个 `beforeToolCall`，只允许调用 `getWeather`，其他工具一律拦截。

### 习题 3（进阶）
修改 L03-06，增加第三个工具 `sendNotification(message)`，让它在 getAdvice 执行后自动发送通知。

### 习题 4（挑战）
实现一个完整的"重试机制"：
- 如果工具执行失败（isError=true），自动重试最多 3 次
- 使用 `shouldStopAfterTurn` 控制重试次数

### 习题 5（挑战）
实现一个"自适应模型选择"：
- 如果上一轮工具调用结果包含"error"，下一轮切换到更强的模型
- 如果上一轮结果正常，保持当前模型

### 习题 6（综合）
设计一个完整的 agent 流程：
1. 用户提问
2. LLM 调用搜索工具
3. `afterToolCall` 脱敏搜索结果
4. LLM 基于结果回答
5. `shouldStopAfterTurn` 限制最多 3 轮
6. `prepareNextTurn` 根据问题复杂度切换模型

---

## 参考资料

- `pi/src/agent-loop.ts` — 核心实现
- `pi/src/types.ts` — 类型定义
- `pi/src/pi-ai.ts` — 基础类型
- `experiments/L03-*.ts` — 12 个实验文件
