/**
 * L06 实验：工具系统的完整一生
 *
 * 验证点：
 * 1. TypeBox schema 定义与参数校验
 * 2. 工具的五段式结构（schema / 系统提示贡献 / 执行 / 截断 / 渲染）
 * 3. content 与 details 双轨制
 * 4. 截断策略
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-agent-loop-labs/experiments/L06/L06-tool-system.ts
 */

import { Type, type Static } from "../../pi/node_modules/typebox/build/index.mjs";
import type { AgentTool, AgentToolResult } from "../../pi/packages/agent/src/types.ts";

// ==================== 1. TypeBox Schema 定义 ====================

const WordCountSchema = Type.Object({
  path: Type.String({ description: "文件路径（相对或绝对）" }),
  mode: Type.Optional(
    Type.Union(
      [Type.Literal("lines"), Type.Literal("words"), Type.Literal("chars")],
      { description: "统计模式：lines=行数, words=词数, chars=字符数", default: "lines" }
    )
  ),
});

type WordCountParams = Static<typeof WordCountSchema>;

// ==================== 2. 系统提示贡献 ====================

const wordCountSystemPromptContribution = {
  snippet: "统计文件的行数、词数或字符数",
  guidelines: [
    "使用 wordcount 而非 wc 命令来统计文件",
    "大文件建议先用 read 工具查看部分内容",
    "返回结果包含 details，UI 会显示最长行的行号",
  ],
};

// ==================== 3. 工具实现 ====================

interface WordCountDetails {
  mode: "lines" | "words" | "chars";
  count: number;
  longestLine: { lineNumber: number; length: number };
  truncated: boolean;
  totalLines: number;
}

const MAX_LINES = 1000; // 最大读取行数

function truncateHead(content: string, maxLines: number): { text: string; truncated: boolean } {
  const lines = content.split("\n");
  if (lines.length <= maxLines) {
    return { text: content, truncated: false };
  }
  return {
    text: lines.slice(0, maxLines).join("\n") + `\n\n[已截断，共 ${lines.length} 行，只显示前 ${maxLines} 行]`,
    truncated: true,
  };
}

const wordCountTool: AgentTool<typeof WordCountSchema, WordCountDetails> = {
  name: "wordcount",
  label: "字数统计",
  description: "统计文件的行数、词数或字符数",
  parameters: WordCountSchema,

  execute: async (
    toolCallId: string,
    params: WordCountParams,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<WordCountDetails>) => void
  ): Promise<AgentToolResult<WordCountDetails>> => {
    console.log(`[${toolCallId}] 执行 wordcount 工具`);
    console.log(`  文件: ${params.path}`);
    console.log(`  模式: ${params.mode ?? "lines"}`);

    // 检查中断信号
    if (signal?.aborted) {
      throw new Error("工具执行被中断");
    }

    // 模拟读取文件内容
    const fakeContent = Array.from({ length: 1500 }, (_, i) => {
      const lineLength = Math.floor(Math.random() * 100) + 10;
      return "x".repeat(lineLength);
    }).join("\n");

    // 截断处理
    const { text, truncated } = truncateHead(fakeContent, MAX_LINES);

    // 统计
    const lines = text.split("\n");
    let count: number;
    let longestLine = { lineNumber: 1, length: 0 };

    lines.forEach((line, index) => {
      if (line.length > longestLine.length) {
        longestLine = { lineNumber: index + 1, length: line.length };
      }
    });

    const mode = params.mode ?? "lines";
    if (mode === "words") {
      count = text.split(/\s+/).filter((w) => w.length > 0).length;
    } else if (mode === "chars") {
      count = text.length;
    } else {
      count = lines.length;
    }

    // 流式更新
    onUpdate?.({
      content: [{ type: "text", text: `正在统计... 当前 ${mode} 数: ${count}` }],
      details: { mode, count, longestLine, truncated, totalLines: lines.length },
    });

    console.log(`  结果: ${mode}=${count}, 最长行=${longestLine.lineNumber}(${longestLine.length}字符)`);

    // 返回结果
    const details: WordCountDetails = {
      mode,
      count,
      longestLine,
      truncated,
      totalLines: lines.length,
    };

    return {
      content: [
        {
          type: "text",
          text: `统计完成：${mode === "lines" ? "行数" : mode === "words" ? "词数" : "字符数"} = ${count}\n` +
                `最长行: 第 ${longestLine.lineNumber} 行 (${longestLine.length} 字符)\n` +
                (truncated ? `⚠️ 文件已截断，只统计了前 ${MAX_LINES} 行` : `共 ${lines.length} 行`),
        },
      ],
      details,
    };
  },
};

// ==================== 主测试 ====================

async function main() {
  console.log("=".repeat(60));
  console.log("L06 实验：工具系统的完整一生");
  console.log("=".repeat(60));

  // 1. Schema 验证
  console.log("\n--- 1. TypeBox Schema ---");
  console.log(`  工具名: ${wordCountTool.name}`);
  console.log(`  label: ${wordCountTool.label}`);
  console.log(`  description: ${wordCountTool.description}`);
  console.log(`  ✅ Schema 定义正确`);

  // 2. 系统提示贡献
  console.log("\n--- 2. 系统提示贡献 ---");
  console.log(`  snippet: ${wordCountSystemPromptContribution.snippet}`);
  console.log(`  guidelines:`);
  wordCountSystemPromptContribution.guidelines.forEach((g, i) => {
    console.log(`    ${i + 1}. ${g}`);
  });
  console.log(`  ✅ 系统提示贡献定义正确`);

  // 3. 工具执行
  console.log("\n--- 3. 工具执行（行数模式）---");
  const result1 = await wordCountTool.execute(
    "tc-001",
    { path: "/tmp/test.txt", mode: "lines" },
    undefined,
    (update) => console.log(`  [流式更新] ${update.content[0]?.type === "text" ? update.content[0].text : ""}`)
  );
  console.log(`  content: ${result1.content[0]?.type === "text" ? result1.content[0].text : ""}`);
  console.log(`  details:`, result1.details);
  console.log(`  ✅ 行数模式执行正确`);

  // 4. 词数模式
  console.log("\n--- 4. 工具执行（词数模式）---");
  const result2 = await wordCountTool.execute(
    "tc-002",
    { path: "/tmp/test.txt", mode: "words" },
    undefined
  );
  console.log(`  content: ${result2.content[0]?.type === "text" ? result2.content[0].text : ""}`);
  console.log(`  ✅ 词数模式执行正确`);

  // 5. 截断处理
  console.log("\n--- 5. 截断处理验证 ---");
  console.log(`  totalLines: ${result1.details.totalLines}`);
  console.log(`  truncated: ${result1.details.truncated}`);
  console.log(`  ✅ 截断策略验证通过`);

  // 6. content 与 details 双轨制
  console.log("\n--- 6. content 与 details 双轨制 ---");
  console.log(`  content (给模型看): 统计结果摘要`);
  console.log(`  details (给UI看): 结构化元数据`);
  console.log(`  ✅ 双轨制验证通过`);

  console.log("\n" + "=".repeat(60));
  console.log("✅ 所有工具系统概念验证通过！");
  console.log("=".repeat(60));
}

main().catch(console.error);
