# L02：AgentTool 接口实现

## 核心教材

- `packages/agent/src/types.ts` — `AgentTool` 接口定义
- `experiments/L02-agent-tool-demo.ts` — 实验代码

## 知识点清单

1. AgentTool 接口的完整结构
2. TypeBox schema 参数定义
3. execute 函数签名与参数
4. AgentToolResult 返回值结构
5. AbortSignal 中断机制
6. 流式更新（onUpdate）回调
7. prepareArguments - 参数兼容 shim
8. addedToolNames - 动态引入新工具
9. AgentToolResult.terminate - 批量提前终止标志
10. executionMode - 单工具级别的执行模式覆盖

## 详细讲解

### 1. AgentTool 接口结构

```typescript
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
  name: string;           // 工具唯一标识
  label: string;          // 显示名称
  description: string;    // 工具描述（给模型看）
  parameters: TParameters; // TypeBox 参数 schema

  // 参数兼容 shim：在 schema validate 之前调用
  prepareArguments?: (args: unknown) => Static<TParameters>;

  execute(
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<TDetails>) => void
  ): Promise<AgentToolResult<TDetails>>;

  // 单工具级别的执行模式覆盖
  executionMode?: ToolExecutionMode;  // "sequential" | "parallel"
}
```

### 2. TypeBox Schema 定义

TypeBox 是一个运行时类型验证库，用于定义工具参数：

```typescript
const WordCountParams = Type.Object({
  text: Type.String({ description: "要统计字数的文本" }),
  mode: Type.Optional(
    Type.Union([Type.Literal("chars"), Type.Literal("words")], {
      description: "统计模式",
      default: "chars",
    })
  ),
});
```

### 3. execute 函数签名

```typescript
execute: async (
  toolCallId: string,      // 工具调用唯一 ID
  params: WordCountParamsType,  // 解析后的参数
  signal?: AbortSignal,    // 中断信号
  onUpdate?: (partialResult: AgentToolResult<WordCountDetails>) => void
): Promise<AgentToolResult<WordCountDetails>>
```

### 4. AgentToolResult 返回值

```typescript
interface AgentToolResult<TDetails = any> {
  content: Array<{ type: "text"; text: string }>;  // 给模型看的内容
  details?: TDetails;  // 给 UI 看的结构化元数据
  usage?: Usage;  // 工具自身的 token 用量（不计入主 LLM 上下文）

  // 动态引入新工具：该工具执行后可用的新工具名
  addedToolNames?: string[];

  // 批量提前终止标志：当批次内所有工具都设置 terminate=true 时才会真正终止
  terminate?: boolean;
}
```

### 5. 中断机制

```typescript
if (signal?.aborted) {
  throw new Error("工具执行被中断");
}
```

### 6. 流式更新

```typescript
onUpdate?.({
  content: [{ type: "text", text: "正在统计..." }],
  details: { mode, count, textLength: params.text.length },
});
```

### 7. prepareArguments - 参数兼容 shim

在 schema 验证之前调用的可选钩子，用于处理旧版本参数格式或规范化输入：

```typescript
const searchTool: AgentTool<typeof SearchParams> = {
  name: "search",
  label: "搜索",
  description: "搜索内容",
  parameters: SearchParams,

  // 处理旧版本参数格式
  prepareArguments: (args) => {
    // 兼容旧版：query -> q
    if (typeof args === "object" && args !== null) {
      const a = args as any;
      if (a.query && !a.q) {
        return { q: a.query, ...a };
      }
    }
    return args as Static<typeof SearchParams>;
  },

  execute: async (toolCallId, params, signal?, onUpdate?) => {
    // params 此时已经是验证后的标准格式
    // ...
  },
};
```

**调用链路**：`raw args → prepareArguments → schema validate → execute`

### 8. addedToolNames - 动态引入新工具

工具执行后可动态注入新工具，使模型能在同一轮对话中使用它们：

```typescript
const registerTool: AgentTool<typeof RegisterParams> = {
  name: "register",
  label: "注册",
  description: "注册后解锁专属工具",
  parameters: RegisterParams,

  execute: async (toolCallId, params, signal?) => {
    // ... 注册逻辑

    return {
      content: [{ type: "text", text: "注册成功" }],
      details: { success: true },
      // 这些新工具从该 tool result 之后可用
      addedToolNames: ["vip_discount", "exclusive_content"],
    };
  },
};
```

**使用场景**：条件性解锁工具、多步骤工作流中后续步骤的工具依赖

### 9. AgentToolResult.terminate - 批量提前终止

当同一轮对话中有多个工具调用时，`terminate` 是一个"提前终止"**提示**：

```typescript
const checkTool: AgentTool = {
  name: "check",
  label: "检查",
  description: "检查条件",
  parameters: CheckParams,

  execute: async (toolCallId, params, signal?) => {
    const passed = await checkCondition(params);

    return {
      content: [{ type: "text", text: passed ? "通过" : "不通过" }],
      details: { passed },
      // 当批次内所有工具都设置 terminate=true 时才会真正终止
      terminate: !passed,
    };
  },
};
```

**关键规则**：
- **只有当该批次内所有 finalize 的工具结果都设置 `terminate=true`** 时，agent loop 才会提前退出
- 如果批次内有任意一个工具没有设置或设置为 `false`，agent 会继续执行后续 turn

### 10. executionMode - 单工具级执行模式覆盖

覆盖全局 `toolExecution` 设置，单独控制某个工具的执行模式：

```typescript
const slowTool: AgentTool = {
  name: "slow_process",
  label: "慢处理",
  description: "耗时较长的处理",
  parameters: SlowParams,

  // 强制串行执行，避免并发冲突
  executionMode: "sequential",

  execute: async (toolCallId, params, signal?) => {
    // ...
  },
};
```

**适用场景**：
- `sequential`：需要独占资源（如写文件、修改数据库）的工具
- `parallel`：全局配置为 sequential 但某个工具可安全并发

## 例题

**题目**：实现一个 `calculate` 工具，支持加减乘除四则运算。

**参考答案**：

```typescript
import { Type, type Static } from "../../pi/node_modules/typebox/build/index.mjs";
import type { AgentTool, AgentToolResult } from "../../pi/packages/agent/src/types.ts";

const CalculateParams = Type.Object({
  a: Type.Number({ description: "第一个操作数" }),
  b: Type.Number({ description: "第二个操作数" }),
  op: Type.Union([
    Type.Literal("add"),
    Type.Literal("sub"),
    Type.Literal("mul"),
    Type.Literal("div"),
  ], { description: "运算符" }),
});

type CalculateParamsType = Static<typeof CalculateParams>;

interface CalculateDetails {
  a: number;
  b: number;
  op: string;
  result: number;
}

const calculateTool: AgentTool<typeof CalculateParams, CalculateDetails> = {
  name: "calculate",
  label: "计算器",
  description: "执行四则运算",
  parameters: CalculateParams,

  execute: async (toolCallId, params, signal?, onUpdate?) => {
    if (signal?.aborted) throw new Error("工具执行被中断");

    let result: number;
    switch (params.op) {
      case "add": result = params.a + params.b; break;
      case "sub": result = params.a - params.b; break;
      case "mul": result = params.a * params.b; break;
      case "div": result = params.a / params.b; break;
    }

    return {
      content: [{ type: "text", text: `结果: ${result}` }],
      details: { a: params.a, b: params.b, op: params.op, result },
    };
  },
};
```

## 课后习题

1. 实现一个 `fileRead` 工具，支持读取文件内容，包含 `path` 和 `encoding` 两个参数
2. 为工具添加 `onUpdate` 回调，模拟读取进度
3. 实现中断机制，当 `signal.aborted` 为 `true` 时抛出错误
4. 实现 `prepareArguments`：处理旧版本 `query` 参数并重命名为 `q`
5. 实现一个 `registerFeature` 工具，执行成功后通过 `addedToolNames` 动态引入新工具
6. 实现 `terminate` 逻辑：当条件不满足时提前终止 agent loop
