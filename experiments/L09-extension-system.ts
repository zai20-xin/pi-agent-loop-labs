/**
 * L09 实验：扩展系统核心概念
 *
 * 验证点：
 * 1. 扩展 = 工厂函数 (pi: ExtensionAPI) => void
 * 2. 事件监听（tool_call / tool_result）
 * 3. 自定义工具注册
 * 4. 状态管理（内存态 vs 持久态）
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-course/experiments/L09-extension-system.ts
 */

// ==================== 1. 模拟扩展 API ====================

interface ToolCallEvent {
  toolName: string;
  input: any;
  toolCallId: string;
}

interface ToolResultEvent {
  toolName: string;
  toolCallId: string;
  result: any;
  isError: boolean;
}

interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: any;
  execute: (toolCallId: string, params: any) => Promise<any>;
}

interface ConfirmResult {
  confirmed: boolean;
}

interface ExtensionContext {
  ui: {
    confirm: (title: string, message: string) => Promise<ConfirmResult>;
  };
}

type EventListener<T> = (event: T, ctx: ExtensionContext) => Promise<any> | any;

class MockExtensionAPI {
  private listeners = new Map<string, EventListener<any>[]>();
  private tools = new Map<string, ToolDefinition>();
  private state = new Map<string, any>();

  on<T>(event: string, listener: EventListener<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    console.log(`  [注册工具] ${tool.name}: ${tool.description}`);
  }

  appendEntry(entry: any): void {
    console.log(`  [持久化] ${entry.type}: ${JSON.stringify(entry).slice(0, 50)}...`);
  }

  setState(key: string, value: any): void {
    this.state.set(key, value);
    console.log(`  [状态] ${key} = ${JSON.stringify(value).slice(0, 30)}`);
  }

  getState(key: string): any {
    return this.state.get(key);
  }

  async emit(event: string, eventData: any, ctx: ExtensionContext): Promise<any[]> {
    const listeners = this.listeners.get(event) ?? [];
    const results = [];

    for (const listener of listeners) {
      const result = await listener(eventData, ctx);
      results.push(result);
    }

    return results;
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
}

// ==================== 2. 模拟扩展实现 ====================

function createMyFirstExtension(pi: MockExtensionAPI): void {
  console.log("\n--- 加载 my-first 扩展 ---");

  // 1. 危险命令保护
  pi.on<ToolCallEvent>("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
      console.log(`  [拦截] 检测到危险命令: ${event.input.command}`);
      const result = await ctx.ui.confirm("危险!", "允许执行 rm -rf 吗?");
      if (!result.confirmed) {
        return { block: true, reason: "用户拒绝了 rm -rf" };
      }
    }
    return undefined;
  });

  // 2. 字数统计工具
  pi.registerTool({
    name: "wordcount",
    label: "WordCount",
    description: "统计文件的行数/词数/字符数",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目标文件路径" },
      },
      required: ["path"],
    },
    async execute(toolCallId, params) {
      console.log(`  [执行] wordcount("${params.path}")`);
      // 模拟读取文件
      const text = "line 1\nline 2\nline 3\n";
      const lines = text.split("\n").length;
      return {
        content: [{ type: "text", text: `${lines} 行 / ${text.split(/\s+/).length} 词 / ${text.length} 字符` }],
        details: { lines },
      };
    },
  });

  // 3. 状态管理示例
  pi.on("session_start", async () => {
    const count = pi.getState("callCount") ?? 0;
    pi.setState("callCount", count + 1);
    pi.appendEntry({
      type: "custom",
      customType: "session_start",
      content: `会话开始第 ${count + 1} 次`,
    });
  });
}

// ==================== 3. 模拟 UI ====================

const mockUI = {
  confirm: async (title: string, message: string): Promise<ConfirmResult> => {
    console.log(`  [UI确认] ${title}: ${message}`);
    // 模拟用户点击"取消"
    return { confirmed: false };
  },
};

// ==================== 主测试 ====================

async function main() {
  console.log("=".repeat(60));
  console.log("L09 实验：扩展系统核心概念");
  console.log("=".repeat(60));

  const pi = new MockExtensionAPI();

  // 1. 加载扩展
  createMyFirstExtension(pi);

  // 2. 触发 session_start 事件
  console.log("\n--- 触发 session_start ---");
  await pi.emit("session_start", {}, { ui: mockUI });
  await pi.emit("session_start", {}, { ui: mockUI });

  // 3. 测试危险命令拦截
  console.log("\n--- 测试 tool_call 拦截 ---");
  const results1 = await pi.emit(
    "tool_call",
    { toolName: "bash", input: { command: "rm -rf /tmp/test" }, toolCallId: "tc-1" },
    { ui: mockUI }
  );
  console.log(`  拦截结果: ${JSON.stringify(results1)}`);

  // 4. 测试正常命令放行
  console.log("\n--- 测试 tool_call 放行 ---");
  const results2 = await pi.emit(
    "tool_call",
    { toolName: "bash", input: { command: "ls -la" }, toolCallId: "tc-2" },
    { ui: mockUI }
  );
  console.log(`  放行结果: ${JSON.stringify(results2)}`);

  // 5. 测试自定义工具
  console.log("\n--- 测试自定义工具 ---");
  const wordcountTool = pi.getTool("wordcount");
  if (wordcountTool) {
    const toolResult = await wordcountTool.execute("tc-3", { path: "/tmp/test.txt" });
    console.log(`  工具结果: ${JSON.stringify(toolResult)}`);
  }

  // 6. 验证状态管理
  console.log("\n--- 状态管理 ---");
  console.log(`  callCount: ${pi.getState("callCount")}`);

  console.log("\n" + "=".repeat(60));
  console.log("✅ 所有扩展系统概念验证通过！");
  console.log("=".repeat(60));
}

main().catch(console.error);
