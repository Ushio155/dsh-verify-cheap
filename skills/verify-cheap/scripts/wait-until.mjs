#!/usr/bin/env node
/**
 * wait-until.mjs — 条件轮询 + 超时（零依赖，Node >= 18）
 *
 * 用途：替代脚本内的固定延时。每次尝试都重新判断条件，条件满足即刻返回，
 *       超时则失败退出，因此不会出现"条件早满足要重试、晚满足就白等"。
 *
 * 用法 A：等待命令成功退出（stdio 忽略，不使用管道）
 *   node <skill-dir>/scripts/wait-until.mjs --timeout 120 -- npm run build
 * 用法 B：等待文件出现 / 端口可连
 *   node <skill-dir>/scripts/wait-until.mjs --timeout 90 --file out/index.js
 *   node <skill-dir>/scripts/wait-until.mjs --timeout 30 --port 3080
 * 用法 C：等待命令输出匹配
 *   node <skill-dir>/scripts/wait-until.mjs --timeout 120 --match "listening on" -- npm run dev
 *   （--match 需要捕获子进程 stdout，在禁止管道 stdio 的受限沙箱中不可用）
 * 用法 D：作为库
 *   import { waitUntil } from "<skill-dir>/scripts/wait-until.mjs";
 *   await waitUntil(() => isReady(), { timeoutMs: 60_000, intervalMs: 500, label: "被测对象就绪" });
 *
 * 退出码：0 = 条件已满足；1 = 超时；2 = 参数错误
 */

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createConnection } from "node:net";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_INTERVAL_MS = 1000;

const USAGE = `用法:
  node wait-until.mjs [选项] -- <命令> [参数...]   命令退出码为 0 即视为满足
  node wait-until.mjs [选项] --file <路径>         路径存在即视为满足
  node wait-until.mjs [选项] --port <端口>         127.0.0.1 该端口可连即视为满足
  node wait-until.mjs [选项] --match <正则> -- <命令>   命令输出匹配正则即视为满足

选项:
  --timeout <秒>    超时时间，默认 60
  --interval <秒>   轮询间隔，默认 1
  --label <文本>    条件名称，用于日志
  --quiet           成功时不打印日志
  -h, --help        显示本帮助

说明:
  每次尝试都会重新运行命令，因此适合"探测型"命令，不适合有副作用的命令。`;

/** 把毫秒格式化成便于阅读的字符串。 */
function formatDuration(ms) {
	if (!Number.isFinite(ms)) return "n/a";
	if (ms < 1000) return `${ms.toFixed(0)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
	const minutes = Math.floor(ms / 60_000);
	return `${minutes} min ${((ms % 60_000) / 1000).toFixed(1)} s`;
}

function delay(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * 反复判断条件直到满足或超时。
 * @param {() => unknown | Promise<unknown>} predicate 条件；抛错按"未满足"处理
 * @param {{timeoutMs?: number, intervalMs?: number, label?: string, quiet?: boolean, log?: (...args: unknown[]) => void}} [options]
 * @returns {Promise<{attempts: number, elapsedMs: number}>} 条件满足时返回尝试次数与耗时
 * @throws 超时抛出 Error
 */
export async function waitUntil(predicate, options = {}) {
	const {
		timeoutMs = DEFAULT_TIMEOUT_MS,
		intervalMs = DEFAULT_INTERVAL_MS,
		label = "条件",
		quiet = false,
		log = console.error,
	} = options;
	const started = performance.now();
	const deadline = started + timeoutMs;
	let attempts = 0;
	for (;;) {
		attempts += 1;
		let met = false;
		try {
			met = Boolean(await predicate());
		} catch {
			met = false;
		}
		const elapsedMs = performance.now() - started;
		if (met) {
			if (!quiet) log(`[verify-cheap] ${label} 已满足: ${attempts} 次尝试 / ${formatDuration(elapsedMs)}`);
			return { attempts, elapsedMs };
		}
		if (performance.now() >= deadline) {
			throw new Error(`${label} 超时: ${formatDuration(performance.now() - started)}（${attempts} 次尝试，间隔 ${formatDuration(intervalMs)}）`);
		}
		await delay(Math.min(intervalMs, Math.max(0, deadline - performance.now())));
	}
}

async function pathExists(target) {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
}

function portOpen(port, host = "127.0.0.1", connectTimeoutMs = 1000) {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host });
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(connectTimeoutMs);
		socket.once("connect", () => finish(true));
		socket.once("timeout", () => finish(false));
		socket.once("error", () => finish(false));
	});
}

/**
 * 运行一次子进程。match 为空时使用 stdio: "ignore"（不产生管道）；
 * 需要读取输出时才使用管道。Windows 下 .cmd/.bat 回退到 shell 模式。
 */
function runOnce(command, args, { match } = {}) {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};
		const attempt = (useShell) => {
			const stdio = match ? ["ignore", "pipe", "pipe"] : "ignore";
			const child = spawn(command, args, { stdio, shell: useShell });
			let output = "";
			if (match && child.stdout) child.stdout.on("data", (chunk) => { output += String(chunk); });
			child.once("error", (error) => {
				if (!useShell && (error.code === "ENOENT" || error.code === "EINVAL")) {
					attempt(true);
					return;
				}
				finish({ ok: false, output, error });
			});
			child.once("exit", (code) => finish({ ok: code === 0, code, output }));
		};
		attempt(false);
	});
}

function parseArgs(argv) {
	const separator = argv.indexOf("--");
	const flags = separator === -1 ? argv : argv.slice(0, separator);
	const command = separator === -1 ? [] : argv.slice(separator + 1);
	const parsed = {
		timeoutMs: DEFAULT_TIMEOUT_MS,
		intervalMs: DEFAULT_INTERVAL_MS,
		label: undefined,
		quiet: false,
		help: false,
		file: undefined,
		port: undefined,
		match: undefined,
		command,
	};
	const number = (raw, flag) => {
		const value = Number(raw);
		if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} 需要一个正数`);
		return value;
	};
	for (let index = 0; index < flags.length; index += 1) {
		const flag = flags[index];
		const next = () => {
			const value = flags[index + 1];
			if (value === undefined || value.startsWith("--")) throw new Error(`${flag} 需要一个值`);
			index += 1;
			return value;
		};
		if (flag === "--timeout") parsed.timeoutMs = number(next(), flag) * 1000;
		else if (flag === "--interval") parsed.intervalMs = number(next(), flag) * 1000;
		else if (flag === "--label") parsed.label = next();
		else if (flag === "--file") parsed.file = next();
		else if (flag === "--port") parsed.port = number(next(), flag);
		else if (flag === "--match") parsed.match = next();
		else if (flag === "--quiet") parsed.quiet = true;
		else if (flag === "-h" || flag === "--help") parsed.help = true;
		else throw new Error(`未知参数: ${flag}`);
	}
	return parsed;
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
	if (parsed.help) {
		console.log(USAGE);
		process.exit(0);
	}
	const targets = [parsed.file === undefined ? 0 : 1, parsed.port === undefined ? 0 : 1, parsed.command.length > 0 ? 1 : 0]
		.reduce((sum, value) => sum + value, 0);
	if (targets !== 1) {
		console.error("[verify-cheap] 需要且只能指定一个等待目标: --file / --port / -- <命令>");
		console.error(USAGE);
		process.exit(2);
	}
	if (parsed.match !== undefined && parsed.command.length === 0) {
		console.error("[verify-cheap] --match 只能与 -- <命令> 一起使用");
		process.exit(2);
	}

	let label = parsed.label;
	let predicate;
	if (parsed.file !== undefined) {
		label ??= `文件出现 ${parsed.file}`;
		predicate = () => pathExists(parsed.file);
	} else if (parsed.port !== undefined) {
		label ??= `端口可连 127.0.0.1:${parsed.port}`;
		predicate = () => portOpen(parsed.port);
	} else {
		const [command, ...args] = parsed.command;
		label ??= parsed.match === undefined ? `命令成功 ${parsed.command.join(" ")}` : `输出匹配 /${parsed.match}/`;
		if (parsed.match === undefined) {
			predicate = async () => (await runOnce(command, args)).ok;
		} else {
			let pattern;
			try {
				pattern = new RegExp(parsed.match);
			} catch (error) {
				console.error(`[verify-cheap] --match 不是合法正则: ${error.message}`);
				process.exit(2);
			}
			predicate = async () => pattern.test((await runOnce(command, args, { match: true })).output);
		}
	}

	try {
		await waitUntil(predicate, {
			timeoutMs: parsed.timeoutMs,
			intervalMs: parsed.intervalMs,
			label,
			quiet: parsed.quiet,
		});
		process.exit(0);
	} catch (error) {
		console.error(`[verify-cheap] ${error.message}`);
		process.exit(1);
	}
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) await main(process.argv.slice(2));
