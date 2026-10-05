# research/trigger-ab —— 「技能到底会不会被加载」的实验归档

**问题**：技能 frontmatter 里的 `description`（以及 `AGENTS.md` 里"先加载某个技能"那句话）**到底影不影响模型去加载这个技能**？只靠读描述猜是没用的，所以直接跑实验。

**手段**：在同一个夹具工作区里反复执行

```js
spawnSync(process.execPath, [BIN, "--profile", "headless", "--json", prompt], { cwd: <fixture> })
// BIN = <DSH 安装目录>/lib/bin.js
```

每个 arm **只差一行文案**（当场改写生效副本的 `SKILL.md` 的 `description`、或 `AGENTS.md` 里的一句规则），跑完在 `finally` 里逐字节还原；每次运行都从 `--json` 事件流里读出**工具调用序列**，判定两件事：

- `loaded`：整轮里有没有调用 `skill(verify-cheap)`；
- `skill-first`：**第一次工具调用**是不是 `skill`（这才是"在动手之前就加载"）。

**结论（一句话）**：`description` 里保留"用条件轮询替代 sleep / 按成本阶梯选手段"这类**具体动作词**，决定了模型是**第一步就加载技能**，还是先乱翻文件、最后才想起来；而 `AGENTS.md` 里再补一句"验证类任务先加载技能"，在已有描述的前提下**没有可测的增量**。

## 目录

| 路径 | 内容 |
|---|---|
| `harness/` | 7 个实验驱动脚本 + `trigger-check.mjs`（结果判读辅助）+ `session-inventory.mjs`（把会话存档导出成 `session-inventory.tsv`），Node 零依赖 |
| `results/` | 每个 harness 的原始结果 `*.json`（逐次运行的调用序列）与 `*.log`（控制台输出，UTF-16LE）；`trigger-new.ndjson` 是一次运行的完整事件流 |
| `fixture/` | 实验场地（`config.txt` + `check-config.mjs` / `check-expected.mjs` / 负向对照 `_bad-*.txt` / 变异体 `_mut-*.txt` / `_sleep-*.ps1` 等）及其自带索引 `SUMMARY.md`、成本表 `.verify-cost.md` |
| `session-inventory.tsv` | 这批实验在 `$DSH_HOME/sessions/` 里落下的 **175 个会话**清单（id、时间、标题、首条提示词、token、工具调用数、是否加载了技能） |

## 实验矩阵与结论

夹具工作区：`%TEMP%\verify-trigger`（只有 `AGENTS.md` 说"本目录不是 git 仓库，是验证夹具场地"，其余全是夹具）。下表"runs"= 实际落盘的会话数。

| harness | 日期 | arm | 提示词 × 重复 | runs | 结论 |
|---|---|---|---|---|---|
| `trigger-ab.mjs` | 2026-10-02 | `new` vs `old`（description 两版） | 4 条 + 1 对照组，各 3 次 | 30 | 两臂都 **12/12** 加载；对照组 **0/3**。→ 换文案不影响"是否加载"，只影响"多早加载" |
| `trigger-disambig.mjs` | 2026-10-02 | `new` / `trim` / `old` | 9 条（R2/T3/D3/N1）× 2 次 | 54 | 对照组 N 组三臂都 0 加载（**没有乱触发**）；D 组 6/6 稳定命中 `repo-summary`；T 组 `trim` 出现 **1 次漏触发**（5/6） |
| `trigger-sleep.mjs` | 2026-10-02 | `new` vs `trim` | Start-Sleep 那 1 条 × 10 次 | 20 | `new` **10/10**、`trim` **9/10** 加载 |
| `trigger-firstcall.mjs` | 2026-10-02 | `new` vs `trim` | 1 条 × 4 次 | 8 | 只看"是否加载"两臂几乎一样；看 **skill-first** 才是分水岭（见下） |
| `trigger-firstcall2.mjs` | 2026-10-02 | `new` vs `trim` | 1 条 × 4 次（带重试） | 8 | `new` **4/4 skill-first**；`trim` **4/4 加载但 0/4 skill-first**（首调是 `read`/`glob`） |
| `agents-ab.mjs` | 2026-10-04 | `base` vs `treat`（`AGENTS.md` 加一句"验证类任务先加载 verify-cheap"） | 4 条 + 对照组，各 4/2 次 | 36 | skill-first **14/16 vs 15/16**、加载 16/16 vs 16/16 → **无可测增量**（所以那句最终没进 `AGENTS.md`） |
| `old-vs-new.mjs` | 2026-10-04 | `new` vs `old`（description 新旧） | 1 条 × 8 次 | 16 | skill-first **6/8 vs 1/8**，Fisher 双侧 **p = 0.041** → 新描述显著更早触发，**采纳 new**（即当前仓库里的 `skills/verify-cheap/SKILL.md`） |

`trigger-firstcall.mjs` 末尾那几条 Fisher 检验用的是**跨轮累计计数**（16/16 vs 14/16、8/12 vs 0/12、p=0.0013 等），数字在脚本里是硬编码的，只能当"当时手上所有样本"的汇总，不能当单轮结论。

## 成本（实测，从会话存档加总）

| 项 | 值 |
|---|---|
| 运行次数 / 会话数 | **175** |
| 事件流落盘 | 10.6 MB |
| token（含缓存读） | **20,124,898**（未命中缓存输入 1,736,846 + 输出 716,819 + 缓存读 17,669,233） |

最贵的一条是 Start-Sleep 那 67 次运行：9.37 M token —— 因为它是唯一在 `trim` 臂上出现漏触发的提示词，被反复加测。

## 复现注意（都是踩过的坑）

1. **这些脚本改写的是"生效副本"** `$DSH_HOME/skills/verify-cheap/SKILL.md`（`agents-ab.mjs` 还会改写 `$DSH_HOME/AGENTS.md`），只在正常退出时由 `finally` 逐字节还原。中途杀进程 = 文件停在 arm 文案上。跑之前先备份，或改成改写临时副本。
2. **`dsh --profile headless` 没有"不落盘"开关**（`--json` / `--session-id` 都不控制持久化），每次运行都会在 `$DSH_HOME/sessions/<项目目录>/` 留一个会话。175 次运行就是这样堆出来的，它们会出现在 GUI 侧栏的"未分组"里（该夹具路径没有注册成工作区）。要干净就把 `$DSH_HOME` 指到一次性目录（需自带 `profiles/`），或者跑完删掉那个项目目录。**本次已归档清单后删除**（2026-10-06）。
3. 路径是**作者本机硬编码**的：`D:/code_practice/AI_coding/DSH_cache/skills/verify-cheap/SKILL.md`、`D:/EageDownload/Node/node_modules/@deepseek-ai/dsh/lib/bin.js`、`%TEMP%\verify-trigger`。换机器要改这三处。
4. `results/*.log` 是 PowerShell 重定向写出的 **UTF-16LE**，`cat`/`read` 会当二进制；用 `node -e "…toString('utf16le')"` 或编辑器选择编码读。
5. 夹具本身有一处**故意错的**配置（见 `fixture/SUMMARY.md` 红线），别顺手"修好"它 —— 负向对照 `_bad-*.txt` 与变异体 `_mut-*.txt` 靠它成立。

## 复现步骤

```powershell
# 1. 建夹具场地（fixture/ 的内容原样拷进去；AGENTS.md 只是个提示）
$fx = Join-Path $env:TEMP 'verify-trigger'; New-Item -ItemType Directory -Force $fx | Out-Null
Copy-Item .\fixture\* $fx -Force
# 2. 改 harness 里那三处硬编码路径（见上）
# 3. 跑一个矩阵（会改写生效副本，跑完自动还原）
node .\harness\old-vs-new.mjs
# 4. 判读：看 results\*.json 里的 loaded / first，而不是看模型回答得好不好
# 5. 收尾：删除本次实验在 $DSH_HOME\sessions\ 下新增的项目目录
```

`session-inventory.tsv` 里每行就是一次运行，`firstPrompt` 相同的行属于同一格矩阵 —— 需要按提示词聚合用量或复核触发率时，直接拿它 group by 即可。它是这样生成的（换一个会话目录也能用）：

```powershell
node .\harness\session-inventory.mjs "$env:DSH_HOME\sessions\<项目目录>" .\session-inventory.tsv
```
