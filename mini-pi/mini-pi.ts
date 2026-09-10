/**
 * L11 毕业设计：mini-Pi（最小可运行 agent）
 *
 * 覆盖 Pi 的四个核心机制：
 * A0: 最小循环（对应 L03）- 调 LLM → 执行工具 → 循环
 * A1: 工具系统（对应 L02/L06）- 注册、校验、执行
 * A2: 会话持久化 + 树（对应 L07）- append-only JSONL + id/parentId
 * A3: 压缩（对应 L08）- 切割点算法 + 摘要生成
 *
 * 规模：~500 行，零外部依赖（除了 Node.js 内置模块）
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-course/mini-pi/mini-pi.ts
 *
 * 与真实 Pi 的差异（详见 L11-差异报告.md）：
 * - 无流式 SSE（本实现用 setTimeout 模拟）
 * - 无 TypeBox schema 校验
 * - 无 beforeToolCall/afterToolCall 钩子
 * - 无 truncateHead 截断
 * - 无 /tree 命令
 * - 无迭代压缩
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ==================== 类型定义 ====================

interface Message {
  id: string;
  parentId: string | null;
  role: "user" | "assistant" | "toolResult" | "compaction";
  content: string;
  timestamp: number;
  // assistant 专属
  stopReason?: "stop" | "toolUse" | "error";
  toolCalls?: ToolCall[];
  // toolResult 专属
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  // compaction 专属
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  // usage
  usage?: Usage;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

interface Tool {
  name: string;
  description: string;
  parameters: any;
  execute: (id: string, params: any) => Promise<{ content: string; details?: any }>;
}

interface Usage {
  input: number;
  output: number;
  cost: number;
}

interface AgentConfig {
  systemPrompt: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  contextWindow: number;
  keepRecentTokens: number;
  reserveTokens: number;
}

interface AgentEvent {
  type: string;
  data?: any;
}

// 流式事件
interface TextDeltaEvent {
  type: "text_delta";
  delta: string;
  partial: string;
}

type StreamEvent = TextDeltaEvent;

// ==================== A0: 最小循环 ====================

class MiniAgentLoop {
  private config: AgentConfig;
  private tools: Map<string, Tool> = new Map();
  private listeners: ((event: AgentEvent) => void)[] = [];

  constructor(config: AgentConfig) {
    this.config = config;
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  onEvent(listener: (event: AgentEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: AgentEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  /**
   * 核心循环：调 LLM → 解析响应 → 执行工具 → 循环
   */
  async run(messages: Message[]): Promise<Message[]> {
    this.emit({ type: "agent_start" });

    let currentMessages = [...messages];
    let hasMoreToolCalls = true;

    while (hasMoreToolCalls) {
      this.emit({ type: "turn_start" });

      // 1. 调 LLM
      const assistantMsg = await this.callLLM(currentMessages);
      currentMessages.push(assistantMsg);
      this.emit({ type: "message", data: assistantMsg });

      // 2. 检查是否有工具调用
      if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        this.emit({ type: "tool_calls", data: assistantMsg.toolCalls });

        // 3. 执行工具
        for (const toolCall of assistantMsg.toolCalls) {
          const tool = this.tools.get(toolCall.name);
          if (!tool) {
            const errorMsg: Message = {
              id: this.genId(),
              parentId: assistantMsg.id,
              role: "toolResult",
              content: `Error: Tool "${toolCall.name}" not found`,
              timestamp: Date.now(),
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              isError: true,
            };
            currentMessages.push(errorMsg);
            continue;
          }

          this.emit({ type: "tool_execution_start", data: { toolCall } });

          try {
            const result = await tool.execute(toolCall.id, toolCall.arguments);
            const toolResult: Message = {
              id: this.genId(),
              parentId: assistantMsg.id,
              role: "toolResult",
              content: result.content,
              timestamp: Date.now(),
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              isError: false,
            };
            currentMessages.push(toolResult);
            this.emit({ type: "tool_execution_end", data: { toolCall, result: toolResult } });
          } catch (error) {
            const errorMsg: Message = {
              id: this.genId(),
              parentId: assistantMsg.id,
              role: "toolResult",
              content: `Error: ${(error as Error).message}`,
              timestamp: Date.now(),
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              isError: true,
            };
            currentMessages.push(errorMsg);
            this.emit({ type: "tool_execution_end", data: { toolCall, result: errorMsg } });
          }
        }

        hasMoreToolCalls = true;
      } else {
        hasMoreToolCalls = false;
      }

      this.emit({ type: "turn_end" });
    }

    this.emit({ type: "agent_end" });
    return currentMessages;
  }

  /**
   * 模拟 LLM 调用（实际应替换为真实 fetch）
   */
  private async callLLM(messages: Message[]): Promise<Message> {
    // 构建上下文
    const context = this.buildContext(messages);

    // 模拟 LLM 响应（实际项目中替换为真实 API 调用）
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const userContent = lastUserMsg?.content ?? "";

    // 检查是否已有工具结果（说明工具调用已完成）
    const hasToolResult = messages.some((m) => m.role === "toolResult");

    // 简单的工具调用模拟：只在第一次且没有工具结果时调用工具
    if (userContent.includes("天气") && !hasToolResult) {
      return {
        id: this.genId(),
        parentId: messages[messages.length - 1]?.id ?? null,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        stopReason: "toolUse",
        toolCalls: [
          {
            id: this.genId(),
            name: "getWeather",
            arguments: { city: "北京" },
          },
        ],
        usage: { input: 100, output: 50, cost: 0.001 },
      };
    }

    // 默认：流式回复
    const fullText = `收到你的消息："${userContent.slice(0, 50)}..."`;
    const assistantMsg: Message = {
      id: this.genId(),
      parentId: messages[messages.length - 1]?.id ?? null,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      stopReason: "stop",
      usage: { input: 100, output: 30, cost: 0.0008 },
    };

    // 模拟流式输出：逐字发送
    await this.streamText(assistantMsg, fullText);

    return assistantMsg;
  }

  /**
   * 模拟流式文本输出
   */
  private async streamText(assistantMsg: Message, fullText: string): Promise<void> {
    let partial = "";

    for (let i = 0; i < fullText.length; i++) {
      const char = fullText[i];
      partial += char;

      // 发送 text_delta 事件
      this.emit({
        type: "message_update",
        data: {
          message: { ...assistantMsg, content: partial },
          assistantMessageEvent: {
            type: "text_delta",
            delta: char,
            partial: partial,
          },
        },
      });

      // 模拟网络延迟
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // 更新完整内容
    assistantMsg.content = fullText;
  }

  /**
   * 构建 LLM 上下文（含压缩逻辑）
   */
  private buildContext(messages: Message[]): string {
    // 简化的上下文构建
    const recentMessages = messages.slice(-10); // 保留最近 10 条
    return recentMessages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n");
  }

  private genId(): string {
    return Math.random().toString(36).slice(2, 10);
  }
}

// ==================== A1: 工具系统 ====================

const weatherTool: Tool = {
  name: "getWeather",
  description: "获取指定城市的天气",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "城市名称" },
    },
    required: ["city"],
  },
  execute: async (id, params) => {
    // 模拟 API 调用
    const weather = `${params.city}今天25°C，晴天`;
    return {
      content: weather,
      details: { tempCelsius: 25, condition: "sunny" },
    };
  },
};

const readFileTool: Tool = {
  name: "readFile",
  description: "读取文件内容",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径" },
    },
    required: ["path"],
  },
  execute: async (id, params) => {
    try {
      // 安全检查：禁止读取敏感文件
      if (params.path.includes(".env") || params.path.includes("node_modules")) {
        throw new Error("禁止读取敏感文件");
      }

      const content = fs.readFileSync(params.path, "utf-8");
      const truncated = content.length > 1000 ? content.slice(0, 1000) + "\n...(已截断)" : content;
      return {
        content: truncated,
        details: { lineCount: content.split("\n").length, truncated: content.length > 1000 },
      };
    } catch (error) {
      throw new Error(`读取文件失败: ${(error as Error).message}`);
    }
  },
};

// ==================== A2: 会话持久化 + 树 ====================

class SessionManager {
  private sessionPath: string;
  private entries: Message[] = [];

  constructor(sessionDir: string) {
    this.sessionPath = path.join(sessionDir, `session-${Date.now()}.jsonl`);
    this.ensureDir(sessionDir);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 追加消息到会话文件
   */
  append(message: Message): void {
    this.entries.push(message);
    fs.appendFileSync(this.sessionPath, JSON.stringify(message) + "\n");
  }

  /**
   * 加载会话
   */
  load(): Message[] {
    if (!fs.existsSync(this.sessionPath)) {
      return [];
    }

    const content = fs.readFileSync(this.sessionPath, "utf-8");
    this.entries = content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));

    return this.entries;
  }

  /**
   * 回退到指定消息（指针移动，不删数据）
   */
  rollbackTo(messageId: string): Message[] {
    // 找到目标消息
    const targetIndex = this.entries.findIndex((e) => e.id === messageId);
    if (targetIndex === -1) {
      throw new Error(`消息 ${messageId} 不存在`);
    }

    // 移动指针（保留 targetIndex 及之前的消息）
    this.entries = this.entries.slice(0, targetIndex + 1);
    return this.entries;
  }

  /**
   * 构建线性上下文（从叶子到根）
   */
  buildLinearContext(leafId: string): Message[] {
    const entryMap = new Map(this.entries.map((e) => [e.id, e]));
    const path: Message[] = [];
    let currentId: string | null = leafId;

    while (currentId) {
      const entry = entryMap.get(currentId);
      if (!entry) break;
      path.unshift(entry);
      currentId = entry.parentId;
    }

    return path;
  }

  getEntries(): Message[] {
    return this.entries;
  }
}

// ==================== A3: 压缩 ====================

/**
 * 压缩管理器
 *
 * 实现 Pi 的核心压缩机制（对应 L08）：
 * 1. 触发公式：contextTokens > contextWindow - reserveTokens
 * 2. 切割点算法：从最新往回走，找到合法切点（user/assistant，不能是 toolResult）
 * 3. toolResult 永不切割：保证 toolCall 和 toolResult 配对
 * 4. 生成摘要：模拟 LLM 生成结构化摘要
 *
 * 与真实 Pi 的差异：
 * - 无迭代压缩（摘要的摘要）
 * - 无 split turn（单轮超预算处理）
 * - 摘要是模拟的，不是真的调 LLM
 */
class CompactionManager {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * 检查是否需要压缩
   */
  shouldCompact(messages: Message[]): boolean {
    const totalTokens = this.estimateTokens(messages);
    const threshold = this.config.contextWindow - this.config.reserveTokens;
    return totalTokens > threshold;
  }

  /**
   * 执行压缩
   */
  compact(messages: Message[]): { compacted: Message[]; summary: Message } {
    // 1. 找到切割点
    const cutPoint = this.findCutPoint(messages);
    if (!cutPoint) {
      throw new Error("无法找到切割点");
    }

    // 2. 分离消息
    const messagesBeforeCut = messages.slice(0, cutPoint.index);
    const messagesAfterCut = messages.slice(cutPoint.index);

    // 3. 生成摘要
    const summaryText = this.generateSummary(messagesBeforeCut);
    const summaryMessage: Message = {
      id: Math.random().toString(36).slice(2, 10),
      parentId: messagesBeforeCut[0]?.parentId ?? null,
      role: "compaction",
      content: summaryText,
      timestamp: Date.now(),
      summary: summaryText,
      firstKeptEntryId: cutPoint.message.id,
      tokensBefore: this.estimateTokens(messagesBeforeCut),
    };

    // 4. 返回压缩后的消息
    return {
      compacted: [summaryMessage, ...messagesAfterCut],
      summary: summaryMessage,
    };
  }

  /**
   * 找到切割点
   */
  private findCutPoint(messages: Message[]): { index: number; message: Message } | null {
    let tokensFromEnd = 0;

    // 从最新消息往回累计 token
    for (let i = messages.length - 1; i >= 0; i--) {
      tokensFromEnd += this.estimateMessageTokens(messages[i]);

      if (tokensFromEnd >= this.config.keepRecentTokens) {
        // 找到合法切点（只能是 user / assistant，不能是 toolResult）
        for (let j = i; j >= 0; j--) {
          const entry = messages[j];
          if (entry.role === "user" || (entry.role === "assistant" && entry.stopReason !== "toolUse")) {
            return { index: j, message: entry };
          }
        }
      }
    }

    return null;
  }

  /**
   * 生成摘要（模拟）
   */
  private generateSummary(messages: Message[]): string {
    const userCount = messages.filter((m) => m.role === "user").length;
    const assistantCount = messages.filter((m) => m.role === "assistant").length;
    const toolCount = messages.filter((m) => m.role === "toolResult").length;

    return `摘要：包含 ${userCount} 个用户问题、${assistantCount} 个助手回复、${toolCount} 个工具结果。`;
  }

  /**
   * 估算 token 数
   */
  private estimateTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);
  }

  private estimateMessageTokens(message: Message): number {
    // 简化估算：中文按字数，英文按空格分词
    const text = message.content + (message.summary ?? "");
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
    const englishWords = text.replace(/[\u4e00-\u9fa5]/g, "").split(/\s+/).filter(Boolean).length;
    return chineseChars + englishWords + 10; // 加上固定开销
  }
}

// ==================== 主程序 ====================

async function main() {
  console.log("=".repeat(60));
  console.log("L11 毕业设计：mini-Pi（最小可运行 agent）");
  console.log("=".repeat(60));

  // 1. 初始化配置
  const config: AgentConfig = {
    systemPrompt: "你是一个助手。",
    model: "mock-model",
    apiKey: "mock-key",
    maxTokens: 2048,
    contextWindow: 128000,
    keepRecentTokens: 20000,
    reserveTokens: 16384,
  };

  // 2. 初始化组件
  const agent = new MiniAgentLoop(config);
  const session = new SessionManager("/tmp/mini-pi-sessions");
  const compaction = new CompactionManager(config);

  // 3. 注册工具
  agent.registerTool(weatherTool);
  agent.registerTool(readFileTool);

  // 4. 订阅事件
  agent.onEvent((event) => {
    const tags: Record<string, string> = {
      agent_start: "🚀 Agent 开始",
      agent_end: "✅ Agent 结束",
      turn_start: "🔄 Turn 开始",
      turn_end: "⏹️ Turn 结束",
    };
    if (tags[event.type]) {
      console.log(`  ${tags[event.type]}`);
    }
  });

  // 5. 模拟对话
  console.log("\n--- 测试1: 简单对话 ---");
  const userMsg1: Message = {
    id: "usr1",
    parentId: null,
    role: "user",
    content: "你好",
    timestamp: Date.now(),
  };
  session.append(userMsg1);

  const messages1 = await agent.run([userMsg1]);
  messages1.forEach((m) => session.append(m));

  console.log(`\n  消息数: ${messages1.length}`);
  console.log(`  消息角色: ${messages1.map((m) => m.role).join(" → ")}`);

  console.log("\n--- 测试2: 工具调用 ---");
  const userMsg2: Message = {
    id: "usr2",
    parentId: messages1[messages1.length - 1]?.id ?? "usr1",
    role: "user",
    content: "北京天气怎么样？",
    timestamp: Date.now(),
  };
  session.append(userMsg2);

  const messages2 = await agent.run([...messages1, userMsg2]);
  messages2.slice(messages1.length).forEach((m) => session.append(m));

  console.log(`\n  新增消息数: ${messages2.length - messages1.length}`);
  console.log(`  完整链路: ${messages2.map((m) => m.role).join(" → ")}`);

  console.log("\n--- 测试3: 会话持久化 ---");
  console.log(`  会话文件: ${session.sessionPath}`);
  const loaded = session.load();
  console.log(`  加载消息数: ${loaded.length}`);

  console.log("\n--- 测试4: 会话回退 ---");
  const rolledBack = session.rollbackTo("usr1");
  console.log(`  回退后消息数: ${rolledBack.length}`);
  console.log(`  保留的消息: ${rolledBack.map((m) => m.role).join(" → ")}`);

  console.log("\n--- 测试5: 压缩检测 ---");
  console.log(`  当前消息数: ${messages2.length}`);
  console.log(`  需要压缩: ${compaction.shouldCompact(messages2) ? "✅ 是" : "❌ 否"}`);

  console.log("\n" + "=".repeat(60));
  console.log("✅ mini-Pi 毕业设计完成！");
  console.log("=".repeat(60));

  // 输出统计
  const stats = {
    文件行数: "~400 行",
    覆盖机制: "循环 / 工具 / 会话 / 压缩",
    外部依赖: "零（仅 Node.js 内置模块）",
  };
  console.log("\n📊 统计:");
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
}

main().catch(console.error);
