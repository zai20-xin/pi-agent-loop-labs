# L10：TUI 差分渲染

## 核心教材

- `packages/tui/src/renderer.ts` — 渲染器实现
- `experiments/L10-tui-diff.ts` — 实验代码

## 知识点清单

1. retained-mode UI：维护组件树，每帧重新计算输出
2. 行级差分：只更新变化的行
3. 无闪烁：同步输出
4. 组件接口设计与 invalidate() 缓存失效
5. 差分算法实现
6. ANSI 转义序列
7. 组件树：嵌套 Container 而非扁平组件列表
8. Layout 树系统：layout-node.ts 声明式布局描述
9. Overlay 系统：锚点定位、堆栈管理、焦点恢复
10. Focusable + CURSOR_MARKER：零宽标记的硬件光标定位
11. 终端颜色方案检测：OSC 11 与 DSR 协议

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
  /** 渲染组件为字符串数组，每个字符串代表一行 */
  render(width: number): string[];

  /** 可选：组件获得焦点时处理键盘输入 */
  handleInput?(data: string): void;

  /** 如果为 true，组件会接收 Kitty 协议的按键释放事件 */
  wantsKeyRelease?: boolean;

  /** 使缓存的渲染状态失效。主题变化或需要从头渲染时调用 */
  invalidate(): void;
}
```

**invalidate() 的设计意图：**

```typescript
// Box 组件的缓存机制示例
class Box implements Component {
  private cache?: { childLines: string[]; width: number; lines: string[] };

  invalidate(): void {
    this.cache = undefined;                    // 1. 清除自身缓存
    for (const child of this.children) {
      child.invalidate?.();                    // 2. 递归向下传播
    }
  }

  render(width: number): string[] {
    if (this.matchCache(width, childLines)) {
      return this.cache!.lines;               // 命中缓存，跳过渲染
    }
    // ... 渲染并缓存
  }
}
```

> **为什么需要 invalidate？** 组件可能缓存 render() 结果（如 Box 缓存背景填充后的输出）。
> 当主题切换、内容变更时，必须显式失效缓存，否则会渲染过时内容。

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

### 5. 组件树：嵌套而非扁平

真实 TUI 不是把组件平铺渲染，而是构建**嵌套组件树**。`Container` 是树的骨架：

```typescript
class Container implements Component {
  children: Component[] = [];

  addChild(component: Component): void {
    this.children.push(component);
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate?.();   // 向下传播失效
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      lines.push(...child.render(width));  // 逐个渲染子组件
    }
    return lines;
  }
}
```

**典型的组件树结构：**

```
TUI (根)
├── VStack
│   ├── Box
│   │   └── Text
│   ├── HStack
│   │   ├── SelectList
│   │   └── ScrollView
│   │       └── Markdown
│   └── Input (implement Focusable)
└── OverlayStack (由 TUI 自动管理)
    └── SettingsDialog
```

**组件树 vs 扁平列表的区别：**

| 特性 | 扁平列表 | 嵌套组件树 |
|------|----------|------------|
| 布局 | 手动指定坐标 | 父组件自动分配空间 |
| 焦点管理 | 全局索引 | 树遍历 |
| 渲染 | 逐个渲染拼接 | 递归渲染，clip 裁剪 |
| 缓存失效 | 全量失效 | invalidate 递归传播 |

### 6. Layout 树系统

Layout 系统是 Pi TUI 的核心——它将"声明式组件树"转化为"精确的屏幕像素位置"。

**两个关键文件：**

- `layout-node.ts`：定义布局节点的**声明式描述**
- `layout.ts`：执行布局计算和**绘制**

#### 6.1 LayoutNode 声明

```typescript
// layout-node.ts — 组件通过 Symbol 暴露布局信息
export const LAYOUT_NODE = Symbol.for(".../layout-node");

interface LayoutComponent extends Component {
  [LAYOUT_NODE](): LayoutNode;  // 返回布局描述
}

type LayoutNode = StackLayoutNode | ScrollLayoutNode;
```

**Stack 布局节点**（VStack / HStack 的底层）：

```typescript
interface StackLayoutNode {
  type: "vstack" | "hstack";
  entries: StackLayoutEntry[];   // 每个子组件的布局约束
  gap: number;                   // 子组件间距
  align: "stretch" | "start" | "center" | "end";
}

interface StackLayoutEntry {
  component: Component;
  basis?: number | "auto";       // 固定尺寸或自适应
  grow?: number;                 // 弹性增长权重
  shrink?: number;               // 弹性收缩权重
  minSize?: number;
  maxSize?: number;
  visible?: (viewport) => boolean;
}
```

**Scroll 布局节点**：

```typescript
interface ScrollLayoutNode {
  type: "scroll";
  component: Component;          // 被滚动的子组件
  state: ScrollLayoutState;      // 滚动状态（scrollTop 等）
}
```

#### 6.2 LayoutBox 绘制树

布局计算的输出是一棵 **LayoutBox 树**：

```typescript
interface LayoutBox {
  component: Component;
  rect: LayoutRect;     // { x, y, width, height } — 绝对位置
  clip: LayoutRect;     // 父级裁剪区域的交集
  children: LayoutBox[];
  parent?: LayoutBox;
  lines?: string[];     // 叶子节点的渲染缓存
  lineOffset?: number;  // 可见区域的偏移量
  layer: number;
}
```

#### 6.3 布局计算流程

```
renderLayoutFrame(root, width, height)
  │
  ├─ 1. layoutComponent(context, root, ...)
  │     ├─ 获取节点类型 getLayoutNode(component)
  │     ├─ 如果是 Stack:
  │     │    ├─ 递归 layoutComponent 每个子组件
  │     │    ├─ allocateStackSizes() 计算弹性分配
  │     │    └─ 构建 LayoutBox（含 children）
  │     ├─ 如果是 Scroll:
  │     │    ├─ 递归 layoutComponent 内容
  │     │    ├─ updateClips() 应用滚动裁剪
  │     │    └─ 构建 LayoutBox（含 scrollView）
  │     └─ 如果是普通组件:
  │          └─ renderCached() 获取输出行，构建叶子 LayoutBox
  │
  └─ 2. paintBox(rootBox, screen, totalWidth)
        ├─ 递归遍历 LayoutBox 树
        ├─ 对每个叶子：compositeTuiLine() 合成到 screen
        ├─ paintScrollbar() 绘制滚动条
        └─ 返回最终的 string[]（帧缓冲）
```

**核心函数：**

```typescript
// 弹性尺寸分配（类似 CSS Flexbox）
function allocateStackSizes(
  entries, intrinsicSizes, availableSize, gap
): number[] {
  // 1. 计算 basis 固定尺寸
  // 2. 如果总尺寸 < 可用空间 → distribute(sizes, entries, diff, "grow")
  // 3. 如果总尺寸 > 可用空间 → distribute(sizes, entries, diff, "shrink")
  // grow/shrink 权重按 weight 分配，受 minSize/maxSize 约束
}
```

#### 6.4 渲染缓存

```typescript
// 避免重复渲染同一组件
function renderCached(context, component, width): string[] {
  // 按 (component, width) 缓存渲染结果
  // 组件 invalidate() 时清除对应缓存
}
```

### 7. Overlay 系统

Overlay 是浮动在基础内容之上的模态层（对话框、通知、加载指示器）。

#### 7.1 核心类型

```typescript
type OverlayAnchor =
  | "center" | "top-left" | "top-right"
  | "bottom-left" | "bottom-right"
  | "top-center" | "bottom-center"
  | "left-center" | "right-center";

interface OverlayOptions {
  // === 尺寸 ===
  width?: number | "50%";       // 列数或百分比
  minWidth?: number;
  maxHeight?: number | "50%";

  // === 锚点定位 ===
  anchor?: OverlayAnchor;        // 默认 "center"
  offsetX?: number;              // 水平偏移（正=右）
  offsetY?: number;              // 垂直偏移（正=下）

  // === 绝对/百分比定位 ===
  row?: number | "25%";          // 行位置
  col?: number | "50%";          // 列位置

  // === 边距 ===
  margin?: { top?: number; right?: number; bottom?: number; left?: number };

  // === 可见性 ===
  visible?: (termWidth: number, termHeight: number) => boolean;
  nonCapturing?: boolean;         // 不抢占焦点
}

interface OverlayHandle {
  hide(): void;                   // 永久移除
  setHidden(hidden: boolean): void; // 临时隐藏/显示
  isHidden(): boolean;
  focus(): void;                  // 获取焦点
  unfocus(options?: { target: Component | null }): void; // 释放焦点
  isFocused(): boolean;
}
```

#### 7.2 锚点定位算法

```typescript
// 锚点 → 行/列位置的映射
resolveAnchorRow(anchor, height, availHeight, marginTop) {
  switch (anchor) {
    case "top-*":    return marginTop;                           // 贴顶
    case "bottom-*": return marginTop + availHeight - height;   // 贴底
    case "*-center": return marginTop + (availHeight - height) / 2; // 垂直居中
  }
}

resolveAnchorCol(anchor, width, availWidth, marginLeft) {
  switch (anchor) {
    case "*-left":   return marginLeft;                           // 贴左
    case "*-right":  return marginLeft + availWidth - width;     // 贴右
    case "center":   return marginLeft + (availWidth - width) / 2; // 水平居中
  }
}
```

#### 7.3 Overlay 堆栈管理

```
overlayStack: OverlayStackEntry[]  (focusOrder 递增)

showOverlay(component, options) → OverlayHandle
  │
  ├─ 入栈，记录 preFocus（弹出前的焦点）
  ├─ 如果 !nonCapturing → setFocus(component)
  └─ 返回 handle

hideOverlay() (弹出栈顶)
  │
  ├─ 出栈
  ├─ 如果出栈组件持有焦点 → 找到下一个可见 overlay 或恢复 preFocus
  └─ 重新定位

unfocus(options?)
  │
  ├─ 释放焦点到下一个可见 capturing overlay
  └─ 或恢复 preFocus，或指定 explicit target
```

**焦点恢复状态机：**

```
inactive ──showOverlay──→ eligible (overlay 持有焦点)
    ↑                         │
    │                    setFocus(null)
    │                         ↓
    │                     blocked (焦点被非 overlay 组件持有)
    │                         │
    └───unfocus───────────────┘
```

#### 7.4 Overlay 合成渲染

```typescript
// compositeOverlays() 将所有 overlay 叠加到基础内容上
compositeOverlays(lines, termWidth, termHeight) {
  // 1. 按 focusOrder 排序（越大越靠前）
  // 2. 对每个可见 overlay:
  //     - resolveOverlayLayout() → { row, col, width }
  //     - component.render(width) → overlayLines
  //     - compositeTuiLine() 合成到 result[row+i]
  // 3. 返回合成后的帧
}
```

### 8. Focusable + CURSOR_MARKER 光标定位

终端硬件光标只有一个，但 TUI 可能有多个可输入组件。Pi 用**零宽标记**解决这个问题：

```typescript
interface Focusable {
  focused: boolean;  // TUI 在焦点切换时设置
}

// 零宽 APC 序列：终端会忽略，但 TUI 能识别
const CURSOR_MARKER = "\x1b_pi:c\x07";
```

**工作流程：**

```
1. Input.render(width)
   └─ 如果 this.focused:
        在光标位置插入 CURSOR_MARKER
        > |Hello|\x1b_pi:c\x07World
        ^^^^^^^^^^^^^^^^^^^^^^^^
        CURSOR_MARKER 在光标前

2. TUI.extractCursorPosition(lines, height)
   ├─ 在渲染后的行中搜索 CURSOR_MARKER
   ├─ 计算 col = visibleWidth(marker之前的文本)
   ├─ 从行中移除 marker
   └─ 返回 { row, col }

3. terminal.setCursorPosition(row, col)
   └─ 将硬件光标移到该位置（用于 IME 输入法候选窗口定位）
```

**为什么用 APC 序列？**

- `\x1b_pi:c\x07` 是终端规范中的"应用程序命令"——终端会忽略它
- 零宽：不影响 visibleWidth 计算
- 可以在渲染后的文本中被精确提取

### 9. 终端颜色方案检测

Pi TUI 能检测终端是深色还是浅色模式，自动调整配色。

#### 9.1 OSC 11 背景色查询

```typescript
// 向终端查询背景色
terminal.write("\x1b]11;?\x07");

// 终端回复格式：
//   \x1b]11;rgb:RRRR/GGGG/BBBB\x07
//   或 \x1b]11;#RRGGBB\x07

function parseOsc11BackgroundColor(data: string): RgbColor | undefined {
  // 解析 RGB 值
  // 返回 { r, g, b } 或 undefined
}
```

#### 9.2 DSR 色彩模式查询

```typescript
// 向终端查询色彩模式
terminal.write("\x1b[?996n");

// 支持的终端回复：
//   \x1b[?997;1n  → dark
//   \x1b[?997;2n  → light

function parseTerminalColorSchemeReport(data: string): TerminalColorScheme | undefined {
  // 返回 "dark" | "light" | undefined
}
```

#### 9.3 实时监听

```typescript
// 启用色彩模式通知（终端主动推送变化）
terminal.write("\x1b[?2031h");

// 监听变化
tui.onTerminalColorSchemeChange((scheme) => {
  if (scheme === "dark") useDarkTheme();
  else useLightTheme();
  // 递归 invalidate 整棵组件树
  tui.invalidate();
});
```

#### 9.4 组件响应颜色变化

```typescript
// invalidate() 的传播链：
tui.invalidate()
  └─ 遍历 children → child.invalidate()
       └─ Box.invalidate()
            ├─ this.cache = undefined    // 清除缓存
            └─ 遍历 children → child.invalidate()
                 └─ Markdown.invalidate()
                      └─ ...递归
```

### 10. 综合：渲染流水线全景

```
┌─────────────────────────────────────────────────────┐
│                   渲染流水线                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  用户输入 / 状态变化 / 终端resize                    │
│       ↓                                             │
│  requestRender() ─── 节流 16ms ──→ renderNow()     │
│       ↓                                             │
│  doRender()                                         │
│       ↓                                             │
│  ┌─ buildRootLayout() ──────────────────────┐      │
│  │  1. layoutComponent() 递归构建 LayoutBox 树  │      │
│  │  2. paintBox() 绘制到 string[] 帧缓冲     │      │
│  └───────────────────────────────────────────┘      │
│       ↓                                             │
│  ┌─ compositeOverlays() ────────────────────┐      │
│  │  3. 遍历 overlayStack，合成到帧缓冲       │      │
│  └───────────────────────────────────────────┘      │
│       ↓                                             │
│  ┌─ diff() + applyDiff() ───────────────────┐      │
│  │  4. 行级差分，只输出变化的行              │      │
│  └───────────────────────────────────────────┘      │
│       ↓                                             │
│  ┌─ extractCursorPosition() ────────────────┐      │
│  │  5. 提取 CURSOR_MARKER，定位硬件光标     │      │
│  └───────────────────────────────────────────┘      │
│       ↓                                             │
│  终端显示                                           │
└─────────────────────────────────────────────────────┘
```

### 11. 应用差分

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

### 12. 渲染流程

```
1. renderFrame(components) → 构建 LayoutBox 树
2. paintBox() → 绘制到 string[] 帧缓冲
3. compositeOverlays() → 合成 overlay 到帧缓冲
4. diff() → 行级差分计算
5. applyDiff() → 应用到终端（只输出变化行）
6. extractCursorPosition() → 定位硬件光标
7. lastScreen = newScreen → 保存当前帧
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
4. 实现一个简单的 Overlay 系统：支持 anchor 定位（center、top-left、bottom-right），能弹出/关闭浮层
5. 实现一个 LayoutNode：让组件通过 `[LAYOUT_NODE]()` 暴露布局描述，由外部计算位置
6. 实现 CURSOR_MARKER 机制：组件在 render() 中插入零宽标记，外部扫描标记位置后设置硬件光标
7. 实现 invalidate() 的递归传播：组件树中任意节点 invalidate() 时，所有祖先和子节点的缓存都失效
8. 实现终端背景色检测：发送 OSC 11 查询，解析 RGB 响应，根据亮度判断 dark/light 模式
