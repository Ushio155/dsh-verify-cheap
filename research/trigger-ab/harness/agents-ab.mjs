import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const AGENTS = "D:/code_practice/AI_coding/DSH_cache/AGENTS.md";
const BIN = "D:/EageDownload/Node/node_modules/@deepseek-ai/dsh/lib/bin.js";
const CWD = path.join(process.env.TEMP, "verify-trigger");
const TMP = process.env.TEMP;

const pristine = fs.readFileSync(AGENTS, "utf8");
const ANCHOR = "- **git 连不上";
if (!pristine.includes(ANCHOR)) throw new Error("anchor line not found in AGENTS.md");

const NEW_RULE = "- **凡是「验证改动 / 跑测试回归 / 等后台作业 / 判断要不要跑全量」的任务，先加载技能：`skill` 工具 → `verify-cheap`** —— 它的价值在**动手之前**选对成本档位，等全套跑完再加载就晚了。\n";
const treated = pristine.replace(ANCHOR, NEW_RULE + ANCHOR);
if (treated === pristine) throw new Error("insertion had no effect");

const PROMPTS = [
	{ id: "sleep", text: "脚本里有一段 Start-Sleep 在等，我觉得不太对，你看呢？" },
	{ id: "green", text: "我这个测试跑一百遍都是绿的，我有点不放心。" },
	{ id: "gap", text: "这个验证脚本自己报 3 秒，外面看却是 40 秒，为什么？" },
	{ id: "full", text: "这次我只是改了一行文本，要不要跑全套测试？" },
];
const CONTROL = { id: "ctl", text: "列出这个目录里的文件。" };
const REPS = 4;
const CTL_REPS = 2;
const ARMS = [
	{ id: "base", content: pristine },
	{ id: "treat", content: treated },
];
const MAX_TRIES = 3;

function setAgents(content) { fs.writeFileSync(AGENTS, content); }

function runOnce(prompt) {
	const res = spawnSync(process.execPath, [BIN, "--profile", "headless", "--json", prompt], {
		cwd: CWD, encoding: "utf8", timeout: 240_000, maxBuffer: 64 * 1024 * 1024,
	});
	if (res.error) return { ok: false, note: `spawn error: ${res.error.message}` };
	const events = (res.stdout ?? "").split("\n").filter(Boolean)
		.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
	if (events.length === 0) {
		const tail = (res.stderr ?? "").split("\n").filter(Boolean).slice(-3).join(" | ");
		return { ok: false, note: `no events; exit=${res.status}; ${tail.slice(0, 240)}` };
	}
	const calls = events.filter((e) => e.type === "tool_call").map((e) => e.tool);
	const skills = events.filter((e) => e.type === "tool_call" && e.tool === "skill").map((e) => e.input?.name);
	return { ok: true, calls, skills };
}
function runWithRetry(prompt) {
	for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
		const r = runOnce(prompt);
		if (r.ok) return { ...r, attempts: attempt };
		console.log(`    ! retry ${attempt}/${MAX_TRIES}: ${r.note}`);
	}
	return { ok: false, calls: [], skills: [], attempts: MAX_TRIES };
}

const rows = [];
try {
	// Interleaved by rep so time drift cannot favour one arm.
	for (let rep = 0; rep < REPS; rep += 1) {
		for (const arm of ARMS) {
			setAgents(arm.content);
			for (const p of PROMPTS) {
				const r = runWithRetry(p.text);
				rows.push({ arm: arm.id, rep, id: p.id, ok: r.ok, skills: r.skills, first: r.calls[0] ?? "" });
				console.log(`${arm.id} r${rep} ${p.id.padEnd(6)} ${r.ok ? (r.calls[0] === "skill" ? "SKILL-FIRST" : "later/" + (r.calls[0] ?? "-")) : "FAILED"}  loaded=${r.skills.join("+") || "none"}`);
			}
		}
	}
	for (let rep = 0; rep < CTL_REPS; rep += 1) {
		for (const arm of ARMS) {
			setAgents(arm.content);
			const r = runWithRetry(CONTROL.text);
			rows.push({ arm: arm.id, rep, id: CONTROL.id, ok: r.ok, skills: r.skills, first: r.calls[0] ?? "" });
			console.log(`${arm.id} r${rep} ${CONTROL.id.padEnd(6)} ${r.ok ? (r.calls[0] === "skill" ? "SKILL-FIRST" : "later/" + (r.calls[0] ?? "-")) : "FAILED"}  loaded=${r.skills.join("+") || "none"}`);
		}
	}
} finally {
	fs.writeFileSync(AGENTS, pristine);
	console.log(`\nRESTORED byte-exact: ${fs.readFileSync(AGENTS, "utf8") === pristine}`);
}

fs.writeFileSync(path.join(TMP, "agents-ab.json"), JSON.stringify(rows, null, 2));
console.log("\n=== skill-first / loaded, per arm");
for (const arm of ARMS) {
	const rs = rows.filter((r) => r.arm === arm.id && r.id !== "ctl" && r.ok);
	const sf = rs.filter((r) => r.first === "skill").length;
	const ld = rs.filter((r) => r.skills.includes("verify-cheap")).length;
	console.log(`${arm.id}: skill-first ${sf}/${rs.length} | loaded ${ld}/${rs.length}`);
	for (const p of PROMPTS) {
		const sub = rs.filter((r) => r.id === p.id);
		console.log(`    ${p.id.padEnd(6)} skill-first ${sub.filter((r) => r.first === "skill").length}/${sub.length}  loaded ${sub.filter((r) => r.skills.includes("verify-cheap")).length}/${sub.length}`);
	}
	const ctl = rows.filter((r) => r.arm === arm.id && r.id === "ctl" && r.ok);
	console.log(`    control loaded ${ctl.filter((r) => r.skills.includes("verify-cheap")).length}/${ctl.length}`);
}
console.log("failed runs:", rows.filter((r) => !r.ok).length);
