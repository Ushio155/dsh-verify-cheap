#!/usr/bin/env node
/**
 * measure-runtime.mjs — 实测耗时工具（零依赖，Node >= 18）
 *
 * 目的：让耗时来自测量，并暴露"外部总时长 vs 脚本内计时"的差异。
 *
 * 用法 A：作为库，在脚本内分段计时
 *   import { createTimer } from "<skill-dir>/scripts/measure-runtime.mjs";
 *   const timer = createTimer("L2 注入回归");
 *   timer.start("prepare");
 *   // ... 被测工作 ...
 *   timer.end("prepare");
 *   await timer.section("run", async () => { ... });
 *   timer.report({ exit: 0 });        // 打印分段表与内外对比；省略 exit 则不退出进程
 *                                    // 报告之后进程若仍存活，退出钩子会补测那段耗时并告警
 *
 * 用法 B：作为 CLI，测量任意命令的外部总时长（子进程 stdio 继承，不使用管道）
 *   node <skill-dir>/scripts/measure-runtime.mjs --label "L3 全量" -- npm test
 *   node <skill-dir>/scripts/measure-runtime.mjs --json -- pwsh -File build.ps1
 *
 * 退出码：CLI 模式透传子进程退出码；子进程无法启动时为 127。
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** 内部时钟起点：模块加载时刻。 */
const PROCESS_START = performance.now();
/** 内外差异的绝对阈值。 */
const GAP_ABSOLUTE_MS = 2000;
/** 内外差异的相对阈值（占内部计时的比例）。 */
const GAP_RATIO = 0.3;

const USAGE = `用法:
  node measure-runtime.mjs --label "<档位 + 用途>" -- <命令> [参数...]
  node measure-runtime.mjs --json -- <命令> [参数...]

选项:
  --label <文本>   本次测量的标签，默认 run
  --json           以 JSON 输出结果
  -h, --help       显示本帮助

说明:
  本脚本测量的是"外部总时长"，即子进程从启动到退出的墙上时间。
  若需要分段耗时与内外对比，请在脚本内 import { createTimer } 使用库模式。`;

/** 把毫秒格式化成便于阅读的字符串。 */
export function formatDuration(ms) {
	if (!Number.isFinite(ms)) return "n/a";
	if (ms < 1000) return `${ms.toFixed(0)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
	const minutes = Math.floor(ms / 60_000);
	return `${minutes} min ${((ms % 60_000) / 1000).toFixed(1)} s`;
}

/**
 * 创建一个分段计时器。
 * @param {string} label 本次测量的标签
 * @param {{log?: (line: string) => void}} [options]
 */
export function createTimer(label = "run", { log = console.log } = {}) {
	const sections = [];
	const marks = [];
	const open = new Map();

	const timer = {
		label,
		/** 开始一个小节。 */
		start(name) {
			if (open.has(name)) throw new Error(`小节已开始: ${name}`);
			open.set(name, performance.now());
			return timer;
		},
		/** 结束一个小节并记录耗时。 */
		end(name) {
			const started = open.get(name);
			if (started === undefined) throw new Error(`小节未开始: ${name}`);
			open.delete(name);
			sections.push({ name, ms: performance.now() - started });
			return timer;
		},
		/** 包裹一段工作，自动开始与结束该小节。 */
		async section(name, work) {
			timer.start(name);
			try {
				return await work();
			} finally {
				timer.end(name);
			}
		},
		/** 记录一个时间点（相对本进程启动）。 */
		mark(name) {
			marks.push({ name, at: performance.now() - PROCESS_START });
			return timer;
		},
		sections,
		marks,
		snapshot() {
			return snapshot(sections, marks, label);
		},
		report({ exit, immediate = true } = {}) {
			const data = timer.snapshot();
			if (immediate) render(data, log);
			// "报告之后"的存活时间只能由退出钩子测量：若成功路径忘记 process.exit()，
			// 外部总时长会在报告之后再涨几十秒，这里补测这一段并给出提示。
			const reportedExternalMs = data.externalMs;
			process.once("exit", () => {
				const finalExternalMs = performance.now() - PROCESS_START;
				const tailMs = finalExternalMs - reportedExternalMs;
				if (tailMs <= data.thresholdMs) return;
				log(`[verify-cheap] 提示: 报告之后进程又存活 ${formatDuration(tailMs)}（外部总时长 ${formatDuration(finalExternalMs)}）`);
				log("      存在未释放的句柄/连接/定时器；成功路径应补 process.exit()，参见 references/anti-patterns.md 第 5 条");
			});
			if (exit !== undefined) process.exit(exit);
			return data;
		},
	};
	return timer;
}

function snapshot(sections, marks, label) {
	const internalMs = sections.reduce((sum, section) => sum + section.ms, 0);
	const externalMs = performance.now() - PROCESS_START;
	const gapMs = externalMs - internalMs;
	const thresholdMs = Math.max(GAP_ABSOLUTE_MS, internalMs * GAP_RATIO);
	return {
		label,
		sections: sections.map((section) => ({
			...section,
			share: internalMs > 0 ? section.ms / internalMs : 0,
		})),
		marks,
		internalMs,
		externalMs,
		gapMs,
		thresholdMs,
		suspectGap: sections.length > 0 && gapMs > thresholdMs,
	};
}

function render(data, log) {
	log(`[verify-cheap] 分段耗时 — ${data.label}`);
	if (data.sections.length > 0) {
		log("| 小节 | 耗时 | 占比 |");
		log("|---|---|---|");
		for (const section of data.sections) {
			log(`| ${section.name} | ${formatDuration(section.ms)} | ${(section.share * 100).toFixed(1)}% |`);
		}
	} else {
		log("| 小节 | 耗时 | 占比 |");
		log("|---|---|---|");
		log("| (未记录小节) | - | - |");
	}
	if (data.marks.length > 0) {
		log(`标记: ${data.marks.map((mark) => `${mark.name}@${formatDuration(mark.at)}`).join(", ")}`);
	}
	log(`内部合计: ${formatDuration(data.internalMs)}`);
	log(`外部总时长: ${formatDuration(data.externalMs)}`);
	log(`差值: ${formatDuration(data.gapMs)} (阈值 ${formatDuration(data.thresholdMs)})`);
	if (data.suspectGap) {
		log("提示: 外部耗时明显大于内部计时，检查未释放的句柄/连接/定时器，或在成功路径补 process.exit()");
		log("      参见 references/anti-patterns.md 第 5 条");
	} else if (data.sections.length > 0) {
		log("判定: 内外耗时一致，无事件循环挂起迹象");
	}
}

/**
 * 运行一个子进程并以 stdio 继承方式透传输出。
 * Windows 下 .cmd/.bat 无法直接 spawn，因此在 ENOENT/EINVAL 时回退到 shell 模式。
 */
function runCommand(command, args) {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};
		const attempt = (useShell) => {
			const child = spawn(command, args, { stdio: "inherit", shell: useShell });
			child.once("error", (error) => {
				if (!useShell && (error.code === "ENOENT" || error.code === "EINVAL")) {
					attempt(true);
					return;
				}
				finish({ code: 127, error });
			});
			child.once("exit", (code, signal) => {
				finish({ code: code ?? (signal ? 1 : 0), signal });
			});
		};
		attempt(false);
	});
}

function parseArgs(argv) {
	const separator = argv.indexOf("--");
	const flags = separator === -1 ? argv : argv.slice(0, separator);
	const command = separator === -1 ? [] : argv.slice(separator + 1);
	let label = "run";
	let json = false;
	let help = false;
	for (let index = 0; index < flags.length; index += 1) {
		const flag = flags[index];
		if (flag === "--json") json = true;
		else if (flag === "-h" || flag === "--help") help = true;
		else if (flag === "--label") {
			label = flags[index + 1];
			index += 1;
			if (label === undefined) throw new Error("--label 需要一个值");
		} else throw new Error(`未知参数: ${flag}`);
	}
	return { label, json, help, command };
}

async function main(argv) {
	let parsed;
	try {
		parsed = parseArgs(argv);
	} catch (error) {
		console.error(`[verify-cheap] ${error.message}`);
		console.error(USAGE);
		process.exit(2);
	}
	if (parsed.help || parsed.command.length === 0) {
		console.log(USAGE);
		process.exit(parsed.help ? 0 : 2);
	}
	const [command, ...args] = parsed.command;
	const started = performance.now();
	const result = await runCommand(command, args);
	const externalMs = performance.now() - started;
	if (parsed.json) {
		console.log(JSON.stringify({ label: parsed.label, command: parsed.command, externalMs, exitCode: result.code }, null, 2));
	} else {
		console.log(`[verify-cheap] 外部实测耗时 — ${parsed.label}: ${formatDuration(externalMs)} (退出码 ${result.code})`);
		if (result.error) console.error(`[verify-cheap] 启动失败: ${result.error.message}`);
	}
	process.exit(result.code);
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) await main(process.argv.slice(2));
