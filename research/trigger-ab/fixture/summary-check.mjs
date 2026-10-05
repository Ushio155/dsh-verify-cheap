#!/usr/bin/env node
/**
 * summary-check.mjs —— 校验 SUMMARY.md 的索引有没有腐烂（纯静态，通常 <0.2 s）
 *
 * 为什么必须有这个脚本：
 *   SUMMARY.md 的价值**全在精确**。而手写行号索引一定会过期 —— 实测第一次写就编出了
 *   一个根本不存在的函数名和两个错行号。这个脚本把"文档说 X 在 A:123"变成可自动验证的断言。
 *
 * 它只校验**行号与名字**是否对得上，不校验说明文字写得好不好 —— 那是人的事。
 *
 * ── SUMMARY.md 顶部需要一个配置块声明根目录 ──────────────────────────
 *
 *   <!-- repo-summary
 *   root: SillyTavern-CardLore
 *   roots:
 *     "ST:": ${LAB_ST_INSTALL:-D:\sillytavern}
 *   -->
 *
 *   root  : 默认根，**相对 SUMMARY.md 所在目录**；没有前缀的条目都按它解析。
 *   roots : 命名前缀 → 根目录。条目写成 `- \`name(args) —— ST:public/script.js:7992 —— 说明\``
 *           时用 `ST:` 对应的根。值支持 `${环境变量}` 与 `${环境变量:-兜底值}`。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   node summary-check.mjs [summaryPath] [--quiet] [--json]
 *   默认找 ./SUMMARY.md（相对本脚本所在目录）
 *   退出码：0 = 全部一致；1 = 有腐烂或配置有问题；2 = 用法/文件问题
 *
 *   缺配置块时**不再检查条目**，只报一条配置错误并退出 1：此时所有条目的 base 都是猜的，
 *   继续检查只会把同一个根因重复成上百条级联错误。输出最多列出 20 条问题（--json 取全量）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
    console.log(`用法: node summary-check.mjs [SUMMARY.md 路径] [--quiet] [--json]
  默认找 ./SUMMARY.md（相对本脚本所在目录），可用环境变量 SUMMARY_PATH 覆盖。
  退出码: 0 = 索引与源码一致；1 = 有腐烂或配置问题；2 = 用法/文件问题
  要求 SUMMARY.md 顶部有 <!-- repo-summary --> 配置块声明 root，格式见 SKILL.md 第二节。`);
    process.exit(0);
}
const quiet = argv.includes('--quiet');
const asJson = argv.includes('--json');
const summaryPath = path.resolve(argv.find(a => !a.startsWith('-')) ?? process.env.SUMMARY_PATH ?? path.join(HERE, 'SUMMARY.md'));

/** 展开 ${VAR} 与 ${VAR:-兜底} */
function expand(s) {
    return s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name, fallback) => {
        const v = process.env[name];
        if (v !== undefined && v !== '') return v;
        return fallback ?? '';
    });
}

/** 解析 <!-- repo-summary ... --> 配置块 */
function parseConfig(text) {
    const m = text.match(/<!--\s*repo-summary\s*\n([\s\S]*?)-->/);
    if (!m) return null;
    const cfg = { root: null, roots: {} };
    let inRoots = false;
    for (const raw of m[1].split('\n')) {
        if (!raw.trim() || raw.trim().startsWith('#')) continue;
        const indented = /^\s+\S/.test(raw);
        const line = raw.trim().replace(/\s+#(?![^{]*\}).*$/, '');

        // 键允许带引号：`"ST:"` 里的冒号不能被当成分隔符
        let k, vRaw;
        const quoted = line.match(/^"([^"]+)"\s*:\s*(.*)$/);
        if (quoted) { [, k, vRaw] = quoted; }
        else {
            const plain = line.match(/^([^:]+)\s*:\s*(.*)$/);
            if (!plain) continue;
            [, k, vRaw] = plain;
        }
        k = k.trim();
        const v = expand(vRaw.trim().replace(/^["']|["']$/g, ''));

        if (k === 'roots' && v === '') { inRoots = true; continue; }
        if (indented && inRoots) { cfg.roots[k] = v; continue; }
        if (k === 'root') { cfg.root = v; inRoots = false; }
    }
    return cfg;
}

if (!fs.existsSync(summaryPath)) {
    console.error('找不到 SUMMARY.md：' + summaryPath);
    process.exit(2);
}
const summaryDir = path.dirname(summaryPath);
const text = fs.readFileSync(summaryPath, 'utf8');
const lines = text.split('\n');

const rel = p => path.relative(process.cwd(), p) || p;

let cfg = parseConfig(text);
const problems = [];

// 缺配置块 -> 立即失败。此时每个条目的 base 都只能靠猜，继续检查会把同一个根因
// 重复成上百条「文件不存在」的级联噪声，把唯一可行动的信号淹没。
// 迁移步骤见 技能目录 references/migration.md。
if (!cfg || !cfg.root) {
    problems.push(`顶部缺少 \`<!-- repo-summary ... -->\` 配置块（至少要有一行 \`root: <目录>\`）。` +
        `没有它就无法知道路径相对谁解析，因此不再继续检查条目 —— 这是"行号腐烂"之外最容易出的错。` +
        `修法：按 SKILL.md「四节模板」在标题与首段之间插入配置块；旧格式文件见 references/migration.md。`);
    const early = {
        summary: rel(summaryPath),
        entries: 0,
        bases: {},
        usedPrefixes: [],
        problems,
    };
    if (asJson) console.log(JSON.stringify(early, null, 2));
    else {
        console.log(`未检查任何索引条目  (${rel(summaryPath)})`);
        console.log('发现问题:');
        for (const p of problems) console.log('  ✗ ' + p);
    }
    process.exit(1);
}
const defaultBase = path.resolve(summaryDir, cfg.root);
const bases = { '': defaultBase };
for (const [k, v] of Object.entries(cfg.roots ?? {})) bases[k] = path.resolve(summaryDir, v);

/** 条目形如： - `name(args) —— 路径:行号 —— 说明`
 *  ⚠️ 整行（含说明）都在反引号内，且**说明里可以再嵌反引号**（如 ``带 ` (N)` 的名字``），
 *     所以不能靠结尾反引号定界 —— 改成把第一个 ` —— ` 之前当签名、第二个当位置、其余全是说明。
 *  `路径` 可带一个已声明的前缀（如 `ST:`），否则按 root 解析。 */
const ENTRY = /^\s*-\s+`(.+)$/;

let checked = 0;
const usedPrefixes = new Set();
for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ENTRY);
    if (!m) continue;
    const parts = m[1].split(/\s+——\s+/);
    if (parts.length < 3) continue;
    const sig = parts[0].trim();
    const loc = parts[1].trim();
    const desc = parts.slice(2).join(' —— ').replace(/`\s*$/, '').trim();

    const name = sig.match(/^([A-Za-z_$][\w$]*)/)?.[1];
    if (!name) { problems.push(`SUMMARY.md:${i + 1}  无法从 \`${sig}\` 里解析出符号名`); continue; }

    // loc 从**最后一个**冒号切开：路径本身可以含点、斜杠、连字符
    const cut = loc.match(/^(.*):(\d+)$/);
    if (!cut) { problems.push(`SUMMARY.md:${i + 1}  \`${loc}\` 不是「路径:行号」形式`); continue; }
    let [, refPath, lineStr] = cut;
    const lineNo = Number(lineStr);
    checked++;

    // 前缀：只有声明过的才算前缀，否则整段都是路径（避免把 Windows 盘符误当前缀）
    let base = defaultBase;
    const pm = refPath.match(/^([A-Za-z][\w-]*:)(.*)$/);
    if (pm && Object.prototype.hasOwnProperty.call(bases, pm[1])) {
        base = bases[pm[1]];
        refPath = pm[2];
        usedPrefixes.add(pm[1]);
    } else if (pm && !Object.prototype.hasOwnProperty.call(bases, pm[1])) {
        problems.push(`SUMMARY.md:${i + 1}  用了未声明的前缀 \`${pm[1]}\`（配置块 roots 里没有它）`);
        continue;
    }

    const file = path.join(base, refPath);
    if (!fs.existsSync(file)) {
        problems.push(`SUMMARY.md:${i + 1}  ${rel(file)} 不存在（base=${rel(base)}）`);
        continue;
    }
    const body = fs.readFileSync(file, 'utf8').split('\n');
    if (lineNo < 1 || lineNo > body.length) {
        problems.push(`SUMMARY.md:${i + 1}  ${refPath}:${lineNo} 超出文件范围（共 ${body.length} 行）`);
        continue;
    }
    if (!body[lineNo - 1].includes(name)) {
        const hits = [];
        body.forEach((l, idx) => { if (l.includes(name)) hits.push(idx + 1); });
        problems.push(`SUMMARY.md:${i + 1}  ${refPath}:${lineNo} 期望「${name}」，实际内容：` +
            `${body[lineNo - 1].trim().slice(0, 70)}` +
            (hits.length ? `  → 真实位置可能是 ${hits.slice(0, 3).join(' / ')}` : `  → **整个文件里没有这个名字**`));
    }
}

const result = {
    summary: rel(summaryPath),
    entries: checked,
    bases: Object.fromEntries(Object.entries(bases).map(([k, v]) => [k || '(默认)', rel(v)])),
    usedPrefixes: [...usedPrefixes],
    problems,
};

if (asJson) console.log(JSON.stringify(result, null, 2));
else if (!quiet || problems.length) {
    console.log(`检查了 ${checked} 条索引条目  (${rel(summaryPath)})`);
    if (problems.length) {
        const MAX_PRINTED = 20;
        console.log('发现问题:');
        for (const p of problems.slice(0, MAX_PRINTED)) console.log('  ✗ ' + p);
        if (problems.length > MAX_PRINTED) {
            console.log(`  … 另有 ${problems.length - MAX_PRINTED} 条问题未列出（用 --json 获取完整列表）`);
        }
    } else console.log('✓ 索引与源码一致（行号未腐烂）');
}
process.exit(problems.length ? 1 : 0);
