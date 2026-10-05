#!/usr/bin/env node
// L0 探针：config.txt 的静态检查。
// 断言 1：每一非空行都是 key=value。
// 断言 2：键集合与期望完全一致（漏键 / 多键 / 拼错都失败）。
// 断言 3：每个值都是非负整数。
// 三条都能真失败：负向对照见 _bad*.txt（格式坏行 / retry 拼错 / retries=abc 均退出 1）。
import fs from "node:fs";

const EXPECTED_KEYS = ["retries", "timeout"];
const target = process.argv[2] ?? new URL("./config.txt", import.meta.url);
const lines = fs
	.readFileSync(target, "utf8")
	.split(/\r?\n/)
	.filter((line) => line.trim().length > 0);

const badLines = [];
for (const [index, line] of lines.entries()) {
	if (!/^[A-Za-z_][\w.]*=[^\r\n]*$/.test(line)) badLines.push(index + 1);
}

const pairs = lines.map((line) => {
	const at = line.indexOf("=");
	return at < 0 ? null : [line.slice(0, at), line.slice(at + 1)];
});
const good = pairs.filter(Boolean);
const keys = good.map(([k]) => k);
const missing = EXPECTED_KEYS.filter((k) => !keys.includes(k));
const extra = keys.filter((k) => !EXPECTED_KEYS.includes(k));
const badValues = good.filter(([, v]) => !/^\d+$/.test(v)).map(([k, v]) => `${k}=${v}`);

const get = (key) => {
	const hit = good.find(([k]) => k === key);
	return hit === undefined ? "<missing>" : hit[1];
};

const ok = badLines.length === 0 && missing.length === 0 && extra.length === 0 && badValues.length === 0;
console.log(
	`lines=${lines.length} badLines=[${badLines.join(",")}] retries=${get("retries")} timeout=${get("timeout")}` +
		` missing=[${missing.join(",")}] extra=[${extra.join(",")}] badValues=[${badValues.join(",")}]`
);
process.exit(ok ? 0 : 1);
