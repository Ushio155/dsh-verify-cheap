import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const LIVE = "D:/code_practice/AI_coding/DSH_cache/skills/verify-cheap/SKILL.md";
const BIN = "D:/EageDownload/Node/node_modules/@deepseek-ai/dsh/lib/bin.js";
const CWD = path.join(process.env.TEMP, "verify-trigger");

const pristine = fs.readFileSync(LIVE, "utf8");
const NEW = pristine.match(/^description:.*$/m)[0];
const TRIM = "description: 验证改动、跑测试/回归、等待后台作业、判断要不要跑全量时使用：按 L0–L3 成本阶梯选能给出确定结论的最便宜手段（静态检查 → 探针 → 集成 → 全量）。";

// The single prompt whose only lexical hook ("sleep") TRIM deletes from the
// description. Focused follow-up on the one observed miss.
const PROMPT = "脚本里有一段 Start-Sleep 在等，我觉得不太对，你看呢？";
const REPS = 10;
const ARMS = [{ id: "new", line: NEW }, { id: "trim", line: TRIM }];

function setDesc(line) {
	fs.writeFileSync(LIVE, pristine.replace(/^description:.*$/m, line));
}
function run(prompt) {
	const res = spawnSync(process.execPath, [BIN, "--profile", "headless", "--json", prompt], {
		cwd: CWD, encoding: "utf8", timeout: 240_000, maxBuffer: 64 * 1024 * 1024,
	});
	if (res.error) return { error: String(res.error.message), skills: [], first: "" };
	const events = (res.stdout ?? "").split("\n").filter(Boolean)
		.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
	const skills = events.filter((e) => e.type === "tool_call" && e.tool === "skill")
		.map((e) => e.input?.name).filter(Boolean);
	const first = events.find((e) => e.type === "tool_call")?.tool ?? "";
	return { skills, first };
}

const results = [];
try {
	for (const arm of ARMS) {
		setDesc(arm.line);
		for (let rep = 0; rep < REPS; rep += 1) {
			const r = run(PROMPT);
			results.push({ arm: arm.id, rep, ...r });
			console.log(`${arm.id} r${String(rep).padStart(2)}  ${r.skills.includes("verify-cheap") ? "VC" : "--"}  first=${r.first}${r.error ? " ERR:" + r.error : ""}`);
		}
	}
} finally {
	fs.writeFileSync(LIVE, pristine);
	console.log(`\nRESTORED byte-exact: ${fs.readFileSync(LIVE, "utf8") === pristine}`);
}
fs.writeFileSync(path.join(process.env.TEMP, "trigger-sleep.json"), JSON.stringify(results, null, 2));
console.log("\n=== focus test: 'Start-Sleep' prompt, 10 reps per arm");
for (const arm of ARMS) {
	const rs = results.filter((r) => r.arm === arm.id);
	console.log(`${arm.id}: ${rs.filter((r) => r.skills.includes("verify-cheap")).length}/${rs.length} loaded verify-cheap`);
}
console.log("errors:", results.filter((r) => r.error).length);
