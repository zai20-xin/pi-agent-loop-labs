/**
 * 一次性跑完所有12个实验
 *
 * 运行：cd /Users/zhangwei/workspace/AI/pi && npx tsx experiments/run-all.ts
 */

import { execSync } from "child_process";

const experiments = [
  { file: "L03-01-no-tool.ts", name: "不调工具" },
  { file: "L03-02-two-tools.ts", name: "调2个工具" },
  { file: "L03-03-before-tool-call.ts", name: "拦截工具" },
  { file: "L03-04-after-tool-call.ts", name: "改写结果" },
  { file: "L03-05-should-stop.ts", name: "提前停止" },
  { file: "L03-06-chain-dependency.ts", name: "链式依赖" },
  { file: "L03-07-loop-continue.ts", name: "续跑" },
  { file: "L03-08-truncation.ts", name: "截断作废" },
  { file: "L03-09-seq-vs-parallel.ts", name: "顺序vs并行" },
  { file: "L03-10-steering.ts", name: "插话" },
  { file: "L03-11-follow-up.ts", name: "追加消息" },
  { file: "L03-12-hot-switch.ts", name: "热切换模型" },
];

console.log("=".repeat(60));
console.log("L03 全部实验批量运行");
console.log("=".repeat(60));
console.log(`共 ${experiments.length} 个实验\n`);

let passed = 0;
let failed = 0;

for (let i = 0; i < experiments.length; i++) {
  const exp = experiments[i];
  const label = `[${i + 1}/${experiments.length}] ${exp.name}`;

  try {
    console.log(`${label} — 运行中...`);
    const output = execSync(
      `npx tsx experiments/${exp.file} 2>&1`,
      { timeout: 10000, encoding: "utf-8" },
    );

    // 检查是否有关键输出
    const hasAgentEnd = output.includes("agent_end");
    const hasConclusion = output.includes("结论");

    if (hasAgentEnd && hasConclusion) {
      console.log(`${label} — ✅ 通过\n`);
      passed++;
    } else {
      console.log(`${label} — ⚠️ 运行完成但输出异常\n`);
      console.log("输出片段:", output.slice(-200));
      failed++;
    }
  } catch (err: any) {
    console.log(`${label} — ❌ 失败`);
    if (err.stderr) {
      console.log("错误:", err.stderr.slice(0, 300));
    } else {
      console.log("错误:", err.message?.slice(0, 300));
    }
    console.log("");
    failed++;
  }
}

console.log("=".repeat(60));
console.log("汇总：");
console.log("=".repeat(60));
console.log(`✅ 通过: ${passed}`);
console.log(`❌ 失败: ${failed}`);
console.log(`总计: ${experiments.length}`);
