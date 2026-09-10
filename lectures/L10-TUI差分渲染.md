# L10：TUI 差分渲染

## 核心教材

- `packages/tui/src/renderer.ts` — 渲染器实现
- `experiments/L10-tui-diff.ts` — 实验代码

## 知识点清单

1. retained-mode UI：维护组件树，每帧重新计算输出
2. 行级差分：只更新变化的行
3. 无闪烁：同步输出
4. 组件接口设计
5. 差分算法实现
6. ANSI 转义序列

## 详细讲解

### 1. Retained-Mode UI

```
传统模式 (Immediate-Mode):
每帧都重绘整个屏幕 → 闪烁、低效

Retained-Mode:
维护组件树 → 每帧重新 render() → 差分更新 → 高效、无闪烁
```

### 2. 组件接口

```typescript
interface Component {
  render(): string[];
}

class Header implements Component {
  render(): string[] {
    return [
      `╔${"═".repeat(50)}╗`,
      `║${this.title.padEnd(50)}║`,
      `╚${"═".repeat(50)}╝`,
    ];
  }
}
```

### 3. 差分算法

```typescript
diff(newScreen: string[]): Change[] {
  const changes: Change[] = [];
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
```

### 4. ANSI 转义序列

```typescript
// 移动光标到指定位置
process.stdout.write(`\x1b[${row};${col}H`);

// 清空行
process.stdout.write(`\x1b[2K`);

// 清空屏幕
process.stdout.write(`\x1b[2J`);
```

### 5. 应用差分

```typescript
applyDiff(changes: Change[]): void {
  for (const change of changes) {
    if (change.type === "add") {
      process.stdout.write(`\x1b[${change.index + 1};1H`);
      process.stdout.write(change.line);
    } else if (change.type === "remove") {
      process.stdout.write(`\x1b[${change.index + 1};1H`);
      process.stdout.write(" ".repeat(52));
    }
  }
}
```

### 6. 渲染流程

```
1. renderFrame(components) → 生成新帧
2. diff(newScreen) → 计算差分
3. applyDiff(changes) → 应用到终端
4. lastScreen = newScreen → 保存当前帧
```

## 例题

**题目**：实现一个简单的 TUI 组件，显示实时更新的计数器。

**参考答案**：

```typescript
interface Component {
  render(): string[];
}

class Counter implements Component {
  private count: number = 0;

  increment(): void {
    this.count++;
  }

  render(): string[] {
    return [
      `┌─ 计数器 ─────────────────────┐`,
      `│ 当前值: ${String(this.count).padEnd(20)} │`,
      `└───────────────────────────────┘`,
    ];
  }
}

class DiffRenderer {
  private lastScreen: string[] = [];

  diff(newScreen: string[]): string[] {
    const output: string[] = [];

    for (let i = 0; i < newScreen.length; i++) {
      if (this.lastScreen[i] !== newScreen[i]) {
        output.push(`\x1b[${i + 1};1H${newScreen[i]}`);
      }
    }

    this.lastScreen = newScreen;
    return output;
  }

  render(components: Component[]): void {
    const lines = components.flatMap(c => c.render());
    const diffs = this.diff(lines);

    process.stdout.write("\x1b[2J");  // 清屏
    diffs.forEach(d => process.stdout.write(d));
  }
}

// 使用示例
const counter = new Counter();
const renderer = new DiffRenderer();

setInterval(() => {
  counter.increment();
  renderer.render([counter]);
}, 1000);
```

## 课后习题

1. 实现一个支持滚动的组件，当内容超过一定行数时自动滚动
2. 实现一个支持颜色的渲染器，使用 ANSI 颜色代码
3. 实现一个支持动画的组件，显示加载进度条
