#!/usr/bin/env node
// Build a TSV inventory of a DSH project session store (v4 multi-frame zstd), for archiving
// what a headless experiment matrix produced before the sessions get deleted.
// usage: node _session-inventory.mjs <projectStoreDir> <outTsv>
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.argv[2];
const out = process.argv[3];
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function decode(file) {
	const buf = fs.readFileSync(file);
	const offsets = [];
	for (let i = 0; i + 4 <= buf.length; i++) if (buf.compare(magic, 0, 4, i, i + 4) === 0) offsets.push(i);
	offsets.push(buf.length);
	const events = [];
	for (let k = 0; k < offsets.length - 1; k++) {
		try {
			const text = zlib.zstdDecompressSync(buf.subarray(offsets[k], offsets[k + 1])).toString("utf8");
			for (const line of text.split(/\r?\n/)) if (line.trim()) events.push(JSON.parse(line));
		} catch { /* skip unreadable frame */ }
	}
	return { buf, events };
}

const clean = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
const rows = [];
const perPrompt = new Map();
for (const d of fs.readdirSync(root, { withFileTypes: true })) {
	if (!d.isDirectory()) continue;
	for (const f of fs.readdirSync(path.join(root, d.name))) {
		if (!f.endsWith(".zstd")) continue;
		const full = path.join(root, d.name, f);
		const { buf, events } = decode(full);
		const head = events.find((e) => e.type === "session") ?? {};
		const titles = events.filter((e) => e.type === "session/title").map((e) => e.data?.title).filter(Boolean);
		let prompt = "";
		for (const e of events) {
			if (e.type !== "user/message") continue;
			const c = e.data?.content ?? e.data?.text ?? "";
			const t = Array.isArray(c) ? c.map((p) => p?.text ?? "").join(" ") : String(c);
			if (t && !t.startsWith("<system-reminder>") && !t.startsWith("Current runtime context")) { prompt = t; break; }
		}
		let tokens = 0;
		for (const e of events) {
			const u = e.data?.usage ?? e.usage;
			if (u && typeof u === "object" && typeof u.totalTokens === "number") tokens += u.totalTokens;
		}
		const tools = events.filter((e) => e.type === "tool/call").length;
		const skills = events.filter((e) => e.type === "tool/call" && e.data?.name === "skill").map((e) => e.data?.arguments ?? "").join(" ");
		const loaded = /verify-cheap/.test(skills) ? "verify-cheap" : "";
		const last = events[events.length - 1];
		rows.push({
			id: d.name,
			createdAt: new Date(head.createdAt ?? 0).toISOString(),
			cwd: head.cwd ?? "",
			title: titles[titles.length - 1] ?? "",
			prompt,
			tokens,
			bytes: buf.length,
			events: events.length,
			tools,
			loaded,
			lastEvent: last?.type ?? "",
		});
		const p = perPrompt.get(prompt) ?? { n: 0, tokens: 0 };
		p.n += 1; p.tokens += tokens;
		perPrompt.set(prompt, p);
	}
}
rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const header = ["sessionId", "createdAt", "cwd", "title", "firstPrompt", "totalTokens", "events", "toolCalls", "loadedSkill", "bytes", "lastEvent"];
fs.writeFileSync(out, [header.join("\t"), ...rows.map((r) => [r.id, r.createdAt, r.cwd, r.title, r.prompt, r.tokens, r.events, r.tools, r.loaded, r.bytes, r.lastEvent].map(clean).join("\t"))].join("\n") + "\n");
console.log(`sessions=${rows.length} rows -> ${out}`);
console.log(`totalTokens=${rows.reduce((s, r) => s + r.tokens, 0)} bytes=${rows.reduce((s, r) => s + r.bytes, 0)}`);
console.log("\nper distinct first prompt:");
for (const [p, v] of [...perPrompt].sort((a, b) => b[1].n - a[1].n)) console.log(`  x${String(v.n).padStart(3)}  tokens=${String(v.tokens).padStart(9)}  ${p.slice(0, 60)}`);
