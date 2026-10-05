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
const MAX_TRIES = 3;

function setDesc(line) { fs.writeFileSync(LIVE, pristine.replace(/^description:.*$/m, line)); }

/** Returns {ok, calls, skills, note}. Never maps a failure onto "no skill loaded". */
function runOnce(prompt) {
	const res = spawnSync(process.execPath, [BIN, "--profile", "headless", "--json", prompt], {
		cwd: CWD, encoding: "utf8", timeout: 240_000, maxBuffer: 64 * 1024 * 1024,
	});
	if (res.error) return { ok: false, note: `spawn error: ${res.error.message}` };
	const stdout = res.stdout ?? "";
	const stderr = res.stderr ?? "";
	const events = stdout.split("\n").filter(Boolean)
		.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
	if (events.length === 0) {
		const tail = stderr.split("\n").filter(Boolean).slice(-4).join(" | ");
		return { ok: false, note: `no events; exit=${res.status}; stderr: ${tail.slice(0, 300)}` };
	}
	const calls = events.filter((e) => e.type === "tool_call")
		.map((e) => ({ tool: e.tool, input: JSON.stringify(e.input ?? {}) }));
	const skills = calls.filter((c) => c.tool === "skill").map((c) => JSON.parse(c.input).name);
	return { ok: true, calls, skills, nEvents: events.length };
}

function runWithRetry(prompt) {
	const notes = [];
	for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
		const r = runOnce(prompt);
		if (r.ok) return { ...r, attempts: attempt, notes };
		notes.push(`try${attempt}: ${r.note}`);
		console.log(`    ! retry (${attempt}/${MAX_TRIES}): ${r.note}`);
	}
	return { ok: false, calls: [], skills: [], attempts: MAX_TRIES, notes };
}

const rows = [];
let failures = 0;
try {
	for (const arm of ARMS) {
		setDesc(arm.line);
		for (let rep = 0; rep < REPS; rep += 1) {
			const r = runWithRetry(PROMPT);
			if (!r.ok) failures += 1;
			rows.push({ arm: arm.id, rep, ...r });
			const loaded = r.skills.includes("verify-cheap");
			const first = r.calls[0] ? `${r.calls[0].tool} ${r.calls[0].input.slice(0, 110)}` : "(no calls)";
			console.log(`${arm.id} r${rep}  ok=${r.ok} loaded=${loaded}  first: ${first}`);
		}
	}
} finally {
	fs.writeFileSync(LIVE, pristine);
	console.log(`\nRESTORED byte-exact: ${fs.readFileSync(LIVE, "utf8") === pristine}`);
}

fs.writeFileSync(path.join(process.env.TEMP, "trigger-firstcall.json"), JSON.stringify(rows, null, 2));

console.log("\n=== summary");
for (const arm of ARMS) {
	const rs = rows.filter((r) => r.arm === arm.id && r.ok);
	const failed = rows.filter((r) => r.arm === arm.id && !r.ok).length;
	const skillFirst = rs.filter((r) => r.calls[0]?.tool === "skill").length;
	const loaded = rs.filter((r) => r.skills.includes("verify-cheap")).length;
	console.log(`${arm.id}: valid runs ${rs.length} (failed ${failed}) | loaded VC ${loaded}/${rs.length} | skill-first ${skillFirst}/${rs.length}`);
	const readFirst = rs.filter((r) => r.calls[0]?.tool === "read");
	for (const r of readFirst) console.log(`    first call was read -> ${r.calls[0].input.slice(0, 160)}`);
}
console.log("failed runs total:", failures);
