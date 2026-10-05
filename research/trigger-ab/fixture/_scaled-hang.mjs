#!/usr/bin/env node
// 诊断演示的**可调版**：把 `.verify-cost.md` 标题里那对数字（内部 3 s / 外面 40 s）真正跑出来。
// 与 `_demo-hang.mjs` 同机制（references/anti-patterns.md 第 5 条：main 返回后 Node 继续等
// 事件循环排空，未关闭的句柄 / 连接 / 定时器把进程多留一段时间），区别是**两个时长可调**，
// 并自带 `FIX=unref` / `FIX=exit` 两条修法对照。
//
//   node _scaled-hang.mjs                  # 内部 3.01 s，外部 40.11 s（默认 HANG_MS=37000）
//   HANG_MS=5000 node _scaled-hang.mjs     # 省时间：约 8.1 s（外部 ≈ WORK_MS + HANG_MS），机制一模一样
//   FIX=unref node _scaled-hang.mjs        # 修法一：句柄 unref()      -> 外部约 3.11 s
//   FIX=exit  node _scaled-hang.mjs        # 修法二：成功路径 exit(0)  -> 外部约 3.09 s
//
// 默认档的断言是"**必须复现**"（差值 > 阈值才退 0）；带 FIX 的两档反过来断言"**必须未复现**"。
// 没有这个方向控制，三条命令都能退 0，等于恒绿（见 SUMMARY.md 红线 9）。
const WORK_MS = Number(process.env.WORK_MS ?? 3000);
const HANG_MS = Number(process.env.HANG_MS ?? 37000);
const FIX = process.env.FIX ?? "";
const expectHang = FIX === "";

const t0 = performance.now();
await new Promise((resolve) => setTimeout(resolve, WORK_MS));
const internalSeconds = (performance.now() - t0) / 1000; // 结算完即固定，不能在 exit 钩子里重算
console.log(`内部合计: ${internalSeconds.toFixed(2)} s`);

const hang = setTimeout(() => {}, HANG_MS); // 罪魁：ref'd 句柄，真实场景里是 server / socket / watcher / 定时器
if (FIX === "unref") hang.unref();

function judge() {
	const external = Number(process.env.DEMO_EXTERNAL_SECONDS ?? process.uptime());
	const threshold = Math.max(2, internalSeconds * 0.3);
	const delta = external - internalSeconds;
	const hung = delta > threshold;
	const ok = expectHang ? hung : !hung;
	console.log(
		`外部 ${external.toFixed(2)} s − 内部 ${internalSeconds.toFixed(2)} s = ${delta.toFixed(2)} s ` +
			`(阈值 ${threshold.toFixed(2)} s) → ${hung ? "复现成功" : "未复现"}` +
			`（期望 ${expectHang ? "复现" : "未复现"} → ${ok ? "通过" : "失败"}）`
	);
	return ok;
}

if (FIX === "exit") {
	// 先判定再退出：显式 exit(0) 会覆盖 exit 钩子里设的 exitCode，所以不能把断言留给钩子。
	console.log("成功路径 process.exit(0)");
	process.exit(judge() ? 0 : 1);
}
process.on("exit", () => {
	process.exitCode = judge() ? 0 : 1;
});
