import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const LIVE = "D:/code_practice/AI_coding/DSH_cache/skills/verify-cheap/SKILL.md";
const BIN = "D:/EageDownload/Node/node_modules/@deepseek-ai/dsh/lib/bin.js";
const CWD = path.join(process.env.TEMP, "verify-trigger");

const pristine = fs.readFileSync(LIVE, "utf8");
const NEW = pristine.match(/^description:.*$/m)[0];
const OLD = "description: 用最低成本验证改动：优先静态检查或探针，不用 sleep 轮询后台作业，耗时以实测为准。跑测试/回归、验证改动、等待后台任务时使用。";
const PROMPT = "脚本里有一段 Start-Sleep 在等，我觉得不太对，你看呢？";
const ARMS = [{ id: "new", line: NEW }, { id: "old", line: OLD }];
const REPS = 8;
const MAX_TRIES = 3;

function setDesc(line) { fs.writeFileSync(LIVE, pristine.replace(/^description:.*$/m, line)); }
function runOnce(prompt) {
	const res = spawnSync(process.execPath, [BIN, "--profile", "headless", "--json", prompt], {
		cwd: CWD, encoding: "utf8", timeout: 240_000, maxBuffer: 64 * 1024 * 1024,
	});
	if (res.error) return { ok: false, note: `spawn error: ${res.error.message}` };
	const events = (res.stdout ?? "").split("\n").filter(Boolean)
		.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
	if (events.length === 0) {
		const tail = (res.stderr ?? "").split("\n").filter(Boolean).slice(-3).join(" | ");
		return { ok: false, note: `no events; exit=${res.status}; ${tail.slice(0, 200)}` };
	}
	const calls = events.filter((e) => e.type === "tool_call").map((e) => e.tool);
	const skills = events.filter((e) => e.type === "tool_call" && e.tool === "skill").map((e) => e.input?.name);
	return { ok: true, calls, skills };
}
function runWithRetry(prompt) {
	for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
		const r = runOnce(prompt);
		if (r.ok) return r;
		console.log(`    ! retry ${attempt}/${MAX_TRIES}: ${r.note}`);
	}
	return { ok: false, calls: [], skills: [] };
}

const rows = [];
try {
	for (let rep = 0; rep < REPS; rep += 1) {
		for (const arm of ARMS) {
			setDesc(arm.line);
			const r = runWithRetry(PROMPT);
			rows.push({ arm: arm.id, rep, ok: r.ok, first: r.calls[0] ?? "", skills: r.skills });
			console.log(`${arm.id} r${rep}  ${r.ok ? (r.calls[0] === "skill" ? "SKILL-FIRST" : "later/" + (r.calls[0] ?? "-")) : "FAILED"}  loaded=${r.skills.join("+") || "none"}`);
		}
	}
} finally {
	fs.writeFileSync(LIVE, pristine);
	console.log(`\nRESTORED byte-exact: ${fs.readFileSync(LIVE, "utf8") === pristine}`);
}
fs.writeFileSync(path.join(process.env.TEMP, "old-vs-new.json"), JSON.stringify(rows, null, 2));

function fisher(a, b, c, d) {
	const lf = (n) => { let s = 0; for (let i = 2; i <= n; i += 1) s += Math.log(i); return s; };
	const lc = (n, k) => lf(n) - lf(k) - lf(n - k);
	const n = a + b + c + d;
	const p = (x) => Math.exp(lc(a + b, x) + lc(c + d, a + c - x) - lc(n, a + c));
	const lo = Math.max(0, (a + c) - (c + d)), hi = Math.min(a + b, a + c), p0 = p(a);
	let sum = 0;
	for (let x = lo; x <= hi; x += 1) { const px = p(x); if (px <= p0 + 1e-12) sum += px; }
	return Math.min(1, sum);
}
console.log("\n=== head-to-head on the 'Start-Sleep' prompt");
for (const arm of ARMS) {
	const rs = rows.filter((r) => r.arm === arm.id && r.ok);
	const sf = rs.filter((r) => r.first === "skill").length;
	const ld = rs.filter((r) => r.skills.includes("verify-cheap")).length;
	console.log(`${arm.id}: skill-first ${sf}/${rs.length} | loaded ${ld}/${rs.length}`);
}
const n = rows.filter((r) => r.arm === "new" && r.ok);
const o = rows.filter((r) => r.arm === "old" && r.ok);
const nsf = n.filter((r) => r.first === "skill").length;
const osf = o.filter((r) => r.first === "skill").length;
console.log(`Fisher skill-first new vs old: p = ${fisher(nsf, n.length - nsf, osf, o.length - osf).toFixed(3)}`);
console.log("failed runs:", rows.filter((r) => !r.ok).length);
