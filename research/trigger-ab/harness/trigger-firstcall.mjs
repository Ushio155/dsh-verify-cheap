import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const LIVE = "D:/code_practice/AI_coding/DSH_cache/skills/verify-cheap/SKILL.md";
const BIN = "D:/EageDownload/Node/node_modules/@deepseek-ai/dsh/lib/bin.js";
const CWD = path.join(process.env.TEMP, "verify-trigger");
const pristine = fs.readFileSync(LIVE, "utf8");
const NEW = pristine.match(/^description:.*$/m)[0];
const TRIM = "description: 验证改动、跑测试/回归、等待后台作业、判断要不要跑全量时使用：按 L0–L3 成本阶梯选能给出确定结论的最便宜手段（静态检查 → 探针 → 集成 → 全量）。";
const PROMPT = "脚本里有一段 Start-Sleep 在等，我觉得不太对，你看呢？";
const ARMS = [{ id: "new", line: NEW }, { id: "trim", line: TRIM }];
const REPS = 4;

function setDesc(line) { fs.writeFileSync(LIVE, pristine.replace(/^description:.*$/m, line)); }
function run(prompt) {
	const res = spawnSync(process.execPath, [BIN, "--profile", "headless", "--json", prompt], {
		cwd: CWD, encoding: "utf8", timeout: 240_000, maxBuffer: 64 * 1024 * 1024,
	});
	const events = (res.stdout ?? "").split("\n").filter(Boolean)
		.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
	const calls = events.filter((e) => e.type === "tool_call")
		.map((e) => `${e.tool}(${JSON.stringify(e.input ?? {}).slice(0, 90)})`);
	const skills = events.filter((e) => e.type === "tool_call" && e.tool === "skill").map((e) => e.input?.name);
	return { calls, skills };
}

const rows = [];
try {
	for (const arm of ARMS) {
		setDesc(arm.line);
		for (let rep = 0; rep < REPS; rep += 1) {
			const r = run(PROMPT);
			rows.push({ arm: arm.id, rep, ...r });
			console.log(`\n${arm.id} r${rep}  loaded=${r.skills.join("+") || "none"}`);
			for (const c of r.calls.slice(0, 2)) console.log(`    ${c}`);
		}
	}
} finally {
	fs.writeFileSync(LIVE, pristine);
	console.log(`\nRESTORED byte-exact: ${fs.readFileSync(LIVE, "utf8") === pristine}`);
}
fs.writeFileSync(path.join(process.env.TEMP, "trigger-firstcall.json"), JSON.stringify(rows, null, 2));

// Fisher exact, two-sided, on 2x2 tables given as [a, b, c, d].
function fisher(a, b, c, d) {
	const logFact = (n) => { let s = 0; for (let i = 2; i <= n; i += 1) s += Math.log(i); return s; };
	const logC = (n, k) => logFact(n) - logFact(k) - logFact(n - k);
	const n = a + b + c + d;
	const p = (x) => Math.exp(logC(a + b, x) + logC(c + d, a + c - x) - logC(n, a + c));
	const lo = Math.max(0, (a + c) - (c + d));
	const hi = Math.min(a + b, a + c);
	const p0 = p(a);
	let sum = 0;
	for (let x = lo; x <= hi; x += 1) { const px = p(x); if (px <= p0 + 1e-12) sum += px; }
	return Math.min(1, sum);
}
console.log("\n=== Fisher exact (two-sided)");
console.log("sleep prompt, loaded VC:  new 16/16 vs trim 14/16 ->  p =", fisher(16, 0, 14, 2).toFixed(3));
console.log("sleep prompt, skill-first: new 8/12 vs trim 0/12  ->  p =", fisher(8, 4, 0, 12).toFixed(4));
console.log("rule-tail group T:        new 6/6  vs trim 5/6    ->  p =", fisher(6, 0, 5, 1).toFixed(3));
console.log("D group (repo-summary):   new 6/6  vs trim 6/6    ->  no difference");
