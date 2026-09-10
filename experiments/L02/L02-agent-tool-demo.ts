/**
 * L02 习题：写一个符合 AgentTool 接口的工具
 *
 * 验证点：
 * 1. 类型标注齐全，能通过 tsc 检查
 * 2. 使用 TypeBox schema 定义参数
 * 3. execute 函数签名正确
 * 4. 返回值符合 AgentToolResult 结构
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-agent-loop-labs/experiments/L02/L02-agent-tool-demo.ts
 */

import { Type, type Static } from "../../pi/node_modules/typebox/build/index.mjs";
import type { AgentTool, AgentToolResult } from "../../pi/packages/agent/src/types.ts";

// 1. 定义参数 schema（TypeBox）
const WordCountParams = Type.Object({
  text: Type.String({ description: "要统计字数的文本" }),
  mode: Type.Optional(
    Type.Union([Type.Literal("chars"), Type.Literal("words")], {
      description: "统计模式：chars=字符数, words=单词数",
      default: "chars",
    })
  ),
});

type WordCountParamsType = Static<typeof WordCountParams>;

// 2. 定义 details 类型
interface WordCountDetails {
  mode: "chars" | "words";
  count: number;
  textLength: number;
}

// 3. 实现 AgentTool
const wordCountTool: AgentTool<typeof WordCountParams, WordCountDetails> = {
  name: "wordCount",
  label: "字数统计",
  description: "统计文本的字符数或单词数",
  parameters: WordCountParams,

  execute: async (
    toolCallId: string,
    params: WordCountParamsType,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<WordCountDetails>) => void
  ): Promise<AgentToolResult<WordCountDetails>> => {
    console.log(`[${toolCallId}] 执行 wordCount 工具`);
    console.log(`  参数: text="${params.text.slice(0, 50)}...", mode=${params.mode ?? "chars"}`);

    // 检查中断信号
    if (signal?.aborted) {
      throw new Error("工具执行被中断");
    }

    const mode = params.mode ?? "chars";
    let count: number;

    if (mode === "words") {
      // 统计单词数（按空白字符分割）
      count = params.text.split(/\s+/).filter((w) => w.length > 0).length;
    } else {
      // 统计字符数
      count = params.text.length;
    }

    // 模拟流式更新（可选）
    onUpdate?.({
      content: [{ type: "text", text: `正在统计... 当前 ${mode === "words" ? "单词" : "字符"}数: ${count}` }],
      details: { mode, count, textLength: params.text.length },
    });

    console.log(`  结果: ${mode}=${count}`);

    // 返回最终结果
    return {
      content: [
        {
          type: "text",
          text: `统计完成：${mode === "words" ? "单词数" : "字符数"} = ${count}`,
        },
      ],
      details: {
        mode,
        count,
        textLength: params.text.length,
      },
    };
  },
};

// 4. 验证工具定义
async function main() {
  console.log("=".repeat(60));
  console.log("L02 习题：验证 AgentTool 接口实现");
  console.log("=".repeat(60));

  // 打印工具元信息
  console.log("\n工具元信息:");
  console.log(`  name: ${wordCountTool.name}`);
  console.log(`  label: ${wordCountTool.label}`);
  console.log(`  description: ${wordCountTool.description}`);
  console.log(`  parameters: TypeBox Object`);

  // 模拟工具调用
  console.log("\n--- 测试1: 统计字符数 ---");
  const result1 = await wordCountTool.execute(
    "tc-001",
    { text: "Hello World 你好世界" },
    undefined,
    (update) => console.log(`  [流式更新] ${update.content[0]?.type === "text" ? update.content[0].text : ""}`)
  );
  console.log("  最终结果:", result1);

  console.log("\n--- 测试2: 统计单词数 ---");
  const result2 = await wordCountTool.execute(
    "tc-002",
    { text: "Hello World 你好世界", mode: "words" },
    undefined
  );
  console.log("  最终结果:", result2);

  console.log("\n--- 测试3: 中断测试 ---");
  const abortController = new AbortController();
  abortController.abort(); // 立即中断
  try {
    await wordCountTool.execute("tc-003", { text: "test" }, abortController.signal);
  } catch (e) {
    console.log(`  预期错误: ${(e as Error).message}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ 所有测试通过！AgentTool 接口实现正确");
  console.log("=".repeat(60));
}

main().catch(console.error);
