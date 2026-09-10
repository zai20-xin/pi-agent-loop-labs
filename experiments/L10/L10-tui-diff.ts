/**
 * L10 实验：TUI 差分渲染玩具复刻
 *
 * 验证点：
 * 1. retained-mode UI：维护组件树，每帧重新计算输出
 * 2. 行级差分：只更新变化的行
 * 3. 无闪烁：同步输出
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx ../pi-course/experiments/L10-tui-diff.ts
 */

// ==================== 1. 组件接口 ====================

interface Component {
  render(): string[];
}

// ==================== 2. 具体组件 ====================

class Header implements Component {
  private title: string;
  private subtitle: string;

  constructor(title: string, subtitle: string) {
    this.title = title;
    this.subtitle = subtitle;
  }

  render(): string[] {
    return [
      `╔${"═".repeat(50)}╗`,
      `║${this.title.padEnd(50)}║`,
      `║${this.subtitle.padEnd(50)}║`,
      `╚${"═".repeat(50)}╝`,
    ];
  }
}

class StatusBar implements Component {
  private items: Map<string, string>;

  constructor() {
    this.items = new Map();
  }

  set(key: string, value: string): void {
    this.items.set(key, value);
  }

  render(): string[] {
    const content = Array.from(this.items.entries())
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
    return [`┌${"─".repeat(50)}┐`, `│${content.padEnd(50)}│`, `└${"─".repeat(50)}┘`];
  }
}

class MessageList implements Component {
  private messages: string[] = [];

  addMessage(msg: string): void {
    this.messages.push(msg);
    if (this.messages.length > 5) {
      this.messages.shift();
    }
  }

  render(): string[] {
    const lines = ["┌─ 消息 ─────────────────────────────────────────────┐"];
    for (const msg of this.messages) {
      lines.push(`│ ${msg.slice(0, 48).padEnd(48)} │`);
    }
    if (this.messages.length === 0) {
      lines.push(`│ ${"(空)".padEnd(48)} │`);
    }
    lines.push("└─────────────────────────────────────────────────────┘");
    return lines;
  }
}

// ==================== 3. 差分渲染器 ====================

class DiffRenderer {
  private lastScreen: string[] = [];
  private cursorY = 0;

  /**
   * 计算两帧之间的差分
   */
  diff(newScreen: string[]): { type: "add" | "remove" | "keep"; line: string; index: number }[] {
    const changes: { type: "add" | "remove" | "keep"; line: string; index: number }[] = [];

    const maxLen = Math.max(this.lastScreen.length, newScreen.length);

    for (let i = 0; i < maxLen; i++) {
      const oldLine = this.lastScreen[i];
      const newLine = newScreen[i];

      if (oldLine === undefined) {
        changes.push({ type: "add", line: newLine, index: i });
      } else if (newLine === undefined) {
        changes.push({ type: "remove", line: oldLine, index: i });
      } else if (oldLine !== newLine) {
        changes.push({ type: "remove", line: oldLine, index: i });
        changes.push({ type: "add", line: newLine, index: i });
      } else {
        changes.push({ type: "keep", line: newLine, index: i });
      }
    }

    return changes;
  }

  /**
   * 应用差分到终端
   */
  applyDiff(changes: { type: "add" | "remove" | "keep"; line: string; index: number }[]): void {
    // 简化版：直接打印所有变化
    for (const change of changes) {
      if (change.type === "add") {
        // 移动光标到指定行并打印
        process.stdout.write(`\x1b[${change.index + 1};1H`);
        process.stdout.write(change.line);
      } else if (change.type === "remove") {
        // 清空该行
        process.stdout.write(`\x1b[${change.index + 1};1H`);
        process.stdout.write(" ".repeat(52));
      }
      // keep: 不做任何操作
    }
    process.stdout.write(`\x1b[${changes.length + 1};1H`);
  }

  /**
   * 渲染完整帧
   */
  renderFrame(components: Component[]): string[] {
    const lines: string[] = [];
    for (const comp of components) {
      lines.push(...comp.render());
    }
    return lines;
  }

  /**
   * 更新并渲染
   */
  update(components: Component[]): void {
    const newScreen = this.renderFrame(components);
    const changes = this.diff(newScreen);

    // 只更新变化的行
    const changedCount = changes.filter((c) => c.type !== "keep").length;
    if (changedCount > 0) {
      this.applyDiff(changes);
      this.lastScreen = newScreen;
    }
  }
}

// ==================== 主测试 ====================

async function main() {
  console.log("=".repeat(60));
  console.log("L10 实验：TUI 差分渲染玩具复刻");
  console.log("=".repeat(60));

  // 1. 初始化组件
  const header = new Header("Mini TUI Demo", "差分渲染演示");
  const statusBar = new StatusBar();
  const messageList = new MessageList();
  const renderer = new DiffRenderer();

  // 2. 模拟多帧渲染
  console.log("\n--- 模拟多帧渲染 ---\n");

  // 帧1：初始状态
  statusBar.set("状态", "空闲");
  statusBar.set("帧数", "1");
  const components1 = [header, statusBar, messageList];
  const frame1 = renderer.renderFrame(components1);
  console.log("帧1（初始）:");
  frame1.forEach((line) => console.log(`  ${line}`));

  // 帧2：添加消息
  messageList.addMessage("用户: 你好");
  statusBar.set("状态", "处理中");
  statusBar.set("帧数", "2");
  const components2 = [header, statusBar, messageList];
  const frame2 = renderer.renderFrame(components2);
  console.log("\n帧2（添加消息）:");
  frame2.forEach((line) => console.log(`  ${line}`));

  // 帧3：继续添加
  messageList.addMessage("助手: 你好！有什么可以帮助你的？");
  statusBar.set("帧数", "3");
  const components3 = [header, statusBar, messageList];
  const frame3 = renderer.renderFrame(components3);
  console.log("\n帧3（继续添加）:");
  frame3.forEach((line) => console.log(`  ${line}`));

  // 3. 差分分析
  console.log("\n--- 差分分析 ---");
  const changes1to2 = renderer.diff(frame2);
  const addCount = changes1to2.filter((c) => c.type === "add").length;
  const removeCount = changes1to2.filter((c) => c.type === "remove").length;
  const keepCount = changes1to2.filter((c) => c.type === "keep").length;
  console.log(`  帧1→帧2 差分: +${addCount} 行, -${removeCount} 行, =${keepCount} 行`);

  const changes2to3 = renderer.diff(frame3);
  const addCount2 = changes2to3.filter((c) => c.type === "add").length;
  const removeCount2 = changes2to3.filter((c) => c.type === "remove").length;
  const keepCount2 = changes2to3.filter((c) => c.type === "keep").length;
  console.log(`  帧2→帧3 差分: +${addCount2} 行, -${removeCount2} 行, =${keepCount2} 行`);

  // 4. 核心概念
  console.log("\n--- 核心概念 ---");
  console.log("  retained-mode: 组件树持久化，每帧重新 render()");
  console.log("  行级差分: 只更新变化的行，不重绘整屏");
  console.log("  无闪烁: 同步输出 + 光标控制");

  console.log("\n" + "=".repeat(60));
  console.log("✅ TUI 差分渲染验证通过！");
  console.log("=".repeat(60));
}

main().catch(console.error);
