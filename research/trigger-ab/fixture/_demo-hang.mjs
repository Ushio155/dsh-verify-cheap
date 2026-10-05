#!/usr/bin/env node
// 诊断演示：复现 references/anti-patterns.md 第 5 条。
// 脚本内计时 0.3 s 就报完，但故意留了一个 ref'd 定时器（模拟未关闭的句柄/连接/
// 定时器）且不调用 process.exit()，Node 必须等事件循环排空才退出 ——
// 于是"内部 0.3 s、外部 5.3 s"。对照组是 check-config.mjs（两条路径都 process.exit）。
// 外部实测值由调用方通过 DEMO_EXTERNAL_SECONDS 传入（例如 measure-runtime.mjs 的耗时），
// 脚本自己在 exit 钩子里比对并据此设退出码 —— 没传就跳过断言。
const t0 = performance.now();
await new Promise((resolve) => setTimeout(resolve, 300));
const internalSeconds = (performance.now() - t0) / 1000; // 脚本自己的工作量，只有 0.3 s 左右
console.log(`内部合计: ${internalSeconds.toFixed(2)} s`);

// 罪魁：这个句柄把进程留住了。真实场景里通常是 server / socket / watcher / 定时器。
const hang = setTimeout(() => {}, 5000);
// 若换成 hang.unref()，进程可正常退出（事件循环不再等它）—— 这才是正确修法之一。

// ── 自断言 ────────────────────────────────────────────────────────────
// 没有它，这个脚本无论快慢都退出 0 —— 那就是"恒绿"，跑它不增任何置信度。
// 判据同 verify-cheap：外部 − 内部 > max(2 s, 内部 × 30%) 才算外部多花的时间无法用脚本内工作解释。
// 内部值在上面**结算完就固定**（不能在 exit 钩子里重算 —— 那时事件循环已排空，
// 重算等于把 5 s 的挂起算进"内部"，差值立刻变成负数，断言恒假）。
// 外部值：优先用调用方传入的 DEMO_EXTERNAL_SECONDS（外部时钟实测），没传就用 process.uptime()
// 兜底 —— 后者就是 Node 自己看到的进程存活时长，相同口径下同样能暴露挂起。
process.on("exit", () => {
	const external = Number(process.env.DEMO_EXTERNAL_SECONDS ?? process.uptime());
	if (Number.isNaN(external)) {
		console.log("外部值不是数字（DEMO_EXTERNAL_SECONDS），自断言跳过");
		return;
	}
	const threshold = Math.max(2, internalSeconds * 0.3);
	const delta = external - internalSeconds;
	const ok = delta > threshold;
	console.log(
		`外部 ${external.toFixed(2)} s − 内部 ${internalSeconds.toFixed(2)} s = ${delta.toFixed(2)} s ` +
			`(阈值 ${threshold.toFixed(2)} s) → ${ok ? "复现成功" : "未复现"}`
	);
	process.exitCode = ok ? 0 : 1;
});
