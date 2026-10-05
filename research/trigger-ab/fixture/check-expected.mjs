#!/usr/bin/env node
// L0 探针：config.txt 的**期望值 + 唯一性**断言（补 check-config.mjs 查不出的那两条漏报）。
// 为什么需要它：check-config.mjs 只验「行格式 / 键集合 / 值是非负整数」，
// 实测 retries=1→999 与追加一行 retries=99 都能让它退出 0（见 _mut-value.txt / _mut-dup.txt）。
// 本脚本用**精确期望值**（不是范围、不是默认值）与**唯一性**堵这两个洞。
//
// 注意：期望值写死在这里是**故意的**。若 config.txt 的预期值真的要改，
// 必须同时改这个文件 —— 否则本脚本会红（这是对的：改配置没改期望，本就该有人看一眼）。
//
// 用法：node check-expected.mjs [config.txt]
// 退出码：0 = 值与唯一性都对；1 = 任一断言失败（并打印差在哪）
import fs from "node:fs";

const EXPECTED = { retries: "1", timeout: "30" };
const target = process.argv[2] ?? new URL("./config.txt", import.meta.url);
const lines = fs
	.readFileSync(target, "utf8")
	.split(/\r?\n/)
	.filter((line) => line.trim().length > 0);

const problems = [];
const seen = new Map();
for (const [index, line] of lines.entries()) {
	const at = line.indexOf("=");
	if (at < 0) continue; // 行格式问题归 check-config.mjs 管，这里不重复报
	const key = line.slice(0, at);
	const value = line.slice(at + 1);
	// 断言 A：重复键（后写覆盖 与 取首个 两种解析器会给出不同结果，必须拒绝）
	if (seen.has(key)) problems.push(`第 ${index + 1} 行重复键 ${key}（首次出现在第 ${seen.get(key)} 行）`);
	else seen.set(key, index + 1);
	// 断言 B：精确期望值（值本身即行为；不含范围判断，范围判断会放过 999）
	if (key in EXPECTED && value !== EXPECTED[key]) {
		problems.push(`${key}=${value}，期望 ${EXPECTED[key]}`);
	}
}
for (const key of Object.keys(EXPECTED)) {
	if (!seen.has(key)) problems.push(`缺少键 ${key}`);
}

const ok = problems.length === 0;
console.log(
	`expected-check keys=${seen.size} retries=${seen.has("retries") ? EXPECTED.retries : "<missing>"}` +
		` timeout=${seen.has("timeout") ? EXPECTED.timeout : "<missing>"} problems=[${problems.join("; ")}]`
);
for (const p of problems) console.log("  ✗ " + p);
process.exit(ok ? 0 : 1);
