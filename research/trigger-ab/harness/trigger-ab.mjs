import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const LIVE = "D:/code_practice/AI_coding/DSH_cache/skills/verify-cheap/SKILL.md";
const BIN = "D:/EageDownload/Node/node_modules/@deepseek-ai/dsh/lib/bin.js";
const CWD = path.join(process.env.TEMP, "verify-trigger");
const TMP = process.env.TEMP;

const pristine = fs.readFileSync(LIVE, "utf8");
const newLine = pristine.match(/^description:.*$/m)[0];
const OLD = "description: 用最低成本验证改动：优先静态检查或探针，不用 sleep 轮询后台作业，耗时以实测为准。跑测试/回归、验证改动、等待后台任务时使用。";

const prompts = [
	"我在这个目录里把 config.txt 的 retries 从 1 改成了 2，帮我确认这次改动。",
	"我刚把这个目录里的 config.txt 改了，怎么知道改对了？",
	"我有个后台任务在跑，得等它完事，我该怎么做？",
	"这次我只是改了一行文本，要不要跑全套测试？",
];
const controls = ["列出这个目录里的文件。"];
const REPS = 3;
const ARMS = [
	{ id: "new", line: newLine },
	{ id: "old", line: OLD },
];

function setDesc(line) {
	fs.writeFileSync(LIVE, pristine.replace(/^description:.*$/m, line));
}
function run(prompt) {
	const res = spawnSync(process.execPath, [BIN, "--profile", "headless", "--json", prompt], {
		cwd: CWD,
		encoding: "utf8",
		timeout: 240_000,
		maxBuffer: 64 * 1024 * 1024,
	});
	const out = res.stdout ?? "";
	if (res.error) return { error: String(res.error.message), calls: [], loaded: false };
	const events = out.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
	const calls = events.filter((e) => e.type === "tool_call").map((e) => e.tool);
	const loaded = events.some((e) => e.type === "tool_call" && e.tool === "skill" && e.input?.name === "verify-cheap");
	const model = events.find((e) => e.type === "session")?.model ?? events.find((e) => e.model)?.model ?? "?";
	return { calls, loaded, model };
}

const results = [];
let session0 = null;
try {
	for (const arm of ARMS) {
		setDesc(arm.line);
		for (let rep = 0; rep < REPS; rep += 1) {
			for (const prompt of [...prompts, ...controls]) {
				const r = run(prompt);
				results.push({ arm: arm.id, rep, prompt, ...r });
				const tag = controls.includes(prompt) ? "CTRL" : "    ";
				console.log(`${arm.id} r${rep} ${tag} ${r.loaded ? "LOAD" : "----"}  [${r.calls.join(">")}]  ${prompt}${r.error ? " ERR:" + r.error : ""}`);
			}
		}
	}
} finally {
	setDesc(newLine);
	fs.writeFileSync(LIVE, pristine);
	const same = fs.readFileSync(LIVE, "utf8") === pristine;
	console.log(`\nRESTORED byte-exact: ${same}`);
}

fs.writeFileSync(path.join(TMP, "trigger-ab.json"), JSON.stringify(results, null, 2));

console.log("\n=== summary (verify-cheap loaded / runs)");
for (const arm of ARMS) {
	const rs = results.filter((r) => r.arm === arm.id && !controls.includes(r.prompt));
	console.log(`ARM ${arm.id}: ${rs.filter((r) => r.loaded).length}/${rs.length}`);
	for (const p of prompts) {
		const sub = rs.filter((r) => r.prompt === p);
		console.log(`   ${sub.filter((r) => r.loaded).length}/${sub.length}  ${p}`);
	}
	const ctl = results.filter((r) => r.arm === arm.id && controls.includes(r.prompt));
	console.log(`   control (must be 0): ${ctl.filter((r) => r.loaded).length}/${ctl.length}`);
}
console.log("\nerrors:", results.filter((r) => r.error).length);
