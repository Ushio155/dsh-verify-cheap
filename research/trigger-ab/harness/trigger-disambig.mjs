import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const LIVE = "D:/code_practice/AI_coding/DSH_cache/skills/verify-cheap/SKILL.md";
const BIN = "D:/EageDownload/Node/node_modules/@deepseek-ai/dsh/lib/bin.js";
const CWD = path.join(process.env.TEMP, "verify-trigger");
const TMP = process.env.TEMP;

const pristine = fs.readFileSync(LIVE, "utf8");
const NEW = pristine.match(/^description:.*$/m)[0];
const OLD = "description: 用最低成本验证改动：优先静态检查或探针，不用 sleep 轮询后台作业，耗时以实测为准。跑测试/回归、验证改动、等待后台任务时使用。";
const TRIM = "description: 验证改动、跑测试/回归、等待后台作业、判断要不要跑全量时使用：按 L0–L3 成本阶梯选能给出确定结论的最便宜手段（静态检查 → 探针 → 集成 → 全量）。";

// Groups:
//  R generic verify-cheap recall (trim must not lose it)
//  T prompts whose only lexical hook is the rule tail that TRIM drops
//  D prompts that belong to the sibling skill repo-summary (routing/contamination)
//  N negative control
const GROUPS = {
	R: [
		"我在这个目录里把 config.txt 的 retries 从 1 改成了 2，帮我确认这次改动。",
		"这次我只是改了一行文本，要不要跑全套测试？",
	],
	T: [
		"我这个测试跑一百遍都是绿的，我有点不放心。",
		"脚本里有一段 Start-Sleep 在等，我觉得不太对，你看呢？",
		"这个验证脚本自己报 3 秒，外面看却是 40 秒，为什么？",
	],
	D: [
		"我要给这个仓库写一份给后续会话看的索引，该写些什么？",
		"这个仓库我第二次来了，之前踩的坑记在哪比较好？",
		"README 写多长合适，要不要再单独搞一份文档？",
	],
	N: ["列出这个目录里的文件。"],
};
const PROMPTS = Object.entries(GROUPS).flatMap(([g, list]) => list.map((p) => ({ group: g, prompt: p })));

const REPS = 2;
const ARMS = [
	{ id: "new", line: NEW },
	{ id: "trim", line: TRIM },
	{ id: "old", line: OLD },
];

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
	const calls = events.filter((e) => e.type === "tool_call").map((e) => e.tool);
	const skills = events.filter((e) => e.type === "tool_call" && e.tool === "skill")
		.map((e) => e.input?.name).filter(Boolean);
	return { skills, first: calls[0] ?? "", nTools: calls.length };
}

const results = [];
try {
	for (const arm of ARMS) {
		setDesc(arm.line);
		for (let rep = 0; rep < REPS; rep += 1) {
			for (const { group, prompt } of PROMPTS) {
				const r = run(prompt);
				results.push({ arm: arm.id, rep, group, prompt, ...r });
				const label = r.skills.map((s) => s.replace("verify-cheap", "VC").replace("repo-summary", "RS").replace("github-ops", "GH")).join("+") || "-";
				console.log(`${arm.id} r${rep} ${group}  [${label}]  first=${r.first}  ${prompt}${r.error ? " ERR:" + r.error : ""}`);
			}
		}
	}
} finally {
	fs.writeFileSync(LIVE, pristine);
	console.log(`\nRESTORED byte-exact: ${fs.readFileSync(LIVE, "utf8") === pristine}`);
}

fs.writeFileSync(path.join(TMP, "trigger-disambig.json"), JSON.stringify(results, null, 2));

console.log("\n=== per arm x group");
const pad = (s, n) => String(s).padEnd(n);
console.log(pad("arm", 6) + pad("group", 7) + pad("n", 4) + pad("VC", 6) + pad("RS", 6) + pad("GH", 6) + "VC-first");
for (const arm of ARMS) {
	for (const g of Object.keys(GROUPS)) {
		const rs = results.filter((r) => r.arm === arm.id && r.group === g);
		const vc = rs.filter((r) => r.skills.includes("verify-cheap")).length;
		const rsm = rs.filter((r) => r.skills.includes("repo-summary")).length;
		const gh = rs.filter((r) => r.skills.includes("github-ops")).length;
		const vcf = rs.filter((r) => r.first === "skill" && r.skills[0] === "verify-cheap").length;
		console.log(pad(arm.id, 6) + pad(g, 7) + pad(rs.length, 4) + pad(vc, 6) + pad(rsm, 6) + pad(gh, 6) + vcf);
	}
}
console.log("\nerrors:", results.filter((r) => r.error).length);
