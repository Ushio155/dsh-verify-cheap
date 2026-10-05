import fs from "node:fs";

const file = process.argv[2];
const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
const calls = [];
for (const line of lines) {
	let o;
	try { o = JSON.parse(line); } catch { continue; }
	if (o.type === "tool_call") {
		const name = o.name ?? o.tool ?? o.data?.name ?? o.call?.name;
		const args = o.args ?? o.data?.args ?? o.call?.args;
		calls.push({ name, args: JSON.stringify(args ?? {}).slice(0, 160) });
	}
}
console.log(`tool calls: ${calls.length}`);
for (const c of calls) console.log(`  ${c.name}  ${c.args}`);
const raw = fs.readFileSync(file, "utf8");
const loaded = calls.some((c) => c.name === "skill" && /verify-cheap/.test(c.args));
const readSkill = calls.some((c) => /verify-cheap/.test(c.args) && c.name !== "skill");
console.log(loaded ? "VERDICT: skill loaded via skill tool" : readSkill ? "VERDICT: SKILL.md read directly (not via skill tool)" : "VERDICT: skill NOT loaded");
