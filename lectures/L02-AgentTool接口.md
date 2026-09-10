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

## 详细讲解

### 1. AgentTool 接口结构

```typescript
interface AgentTool<TSchema = any, TDetails = any> {
  name: string;           // 工具唯一标识
  label: string;          // 显示名称
  description: string;    // 工具描述（给模型看）
  parameters: TSchema;    // TypeBox 参数 schema

  execute(
    toolCallId: string,
    params: Static<TSchema>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<TDetails>) => void
  ): Promise<AgentToolResult<TDetails>>;
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
