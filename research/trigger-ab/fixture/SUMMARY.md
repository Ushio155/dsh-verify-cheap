# SUMMARY.md — verify-trigger 索引（写给 AI 队友）

<!-- repo-summary
root: .
-->

> 基线：本目录**不是 git 仓库**（`git rev-parse` 实测 `not a git repository`），所以没有 sha 可对。
> 行号快照改用「本文件写入时的实测耗时」；行号腐烂用 `node summary-check.mjs` 兜（退出码 0 = 一致）。
> ⚠️ 数行数别用 `Get-Content | Measure-Object -Line`：实测把 41 行的 `check-config.mjs` 数成 31 行；
> 用 `node -e "console.log(fs.readFileSync(f,'utf8').split('\n').length)"`。纯 LF、无 BOM。
> 这里的耗时全部来自实测（2026/10/2，同一台机，node 裸启动基线约 80 ms），**不是估计值**。

## 0. 这个目录是什么（不写清这条，后面几条红线全都读不懂）

**它是"验证成本阶梯"（技能 `verify-cheap`）的试车场地**，不是产品代码：
- 这里的东西是**夹具**，被故意造错（`_bad-*.txt` / `_mut-*.txt`），用来证明断言**真能失败**；
- 会话名带"verify-trigger"，你可能为了验证技能触发而反复进来 —— 修夹具之前先确认它是不是"故意错的"；
- 它**没有 `package.json`**、没有测试运行器、没有构建 —— 所以不存在"跑全套测试"这个选项，别去找；
- 文件都是中文 UTF-8，路径里没有 `.git`，`dsh-code-index` 的三个工具（`code_search` / `code_refs` / `code_map`）在这里**一律报 `no git repository found`**，别浪费一次调用。

## 1. 核心文件地图

| 文件 | 一句话作用（它为什么存在） |
|---|---|
| `check-config.mjs` | L0 探针：只验 `config.txt` 的**行格式 / 键集合 / 值是非负整数**，三条断言 |
| `check-expected.mjs` | L0 探针：验**精确期望值与键唯一性** —— 补上 `check-config.mjs` 明确查不出的两个漏报 |
| `config.txt` | 被校验的配置本体（`retries=1` / `timeout=30`），**值本身即行为** |
| `_bad-format.txt` / `_bad-typo.txt` / `_bad-value.txt` | 负向对照：证明 `check-config.mjs` 的三条断言各自都能失败 |
| `_bad-expected.txt` | 负向对照：证明 `check-expected.mjs` 的期望值断言能失败 |
| `_mut-value.txt` / `_mut-dup.txt` | **变异体**：证明"绿 ≠ 值对"（`retries=999`、重复键都让 `check-config.mjs` 退出 0） |
| `_demo-hang.mjs` | 句柄挂起复现：内部只跑 0.3 s、外部实耗约 5.4 s，自断言差值超阈值才退 0 |
| `_sleep-vs-condition.ps1` | **固定延时的用处**：子进程按已知时长占住命名互斥体，对照"固定 800 ms"与"条件轮询+超时"（详见 4.11） |
| `_sleep-file-lock-probe.ps1` | 上面那条的**文件句柄版**：`Stop-Process -Force` 之后文件独占锁多久才释放（这就是 `cleanup-accelerators.ps1` 想等的东西） |
| `_pipe-block-probe.ps1` | **管道背压版**：子进程只干 0.2 s 活，但 200 KB stdout 没人读 → 父进程 `WaitForExit(8000)` 到点仍返回 False（外部 11.48 s）。这就是"3 s / 40 s"症状在 PowerShell 父子进程里的形态 |
| `_scaled-hang.mjs` | **可调版挂起复现**：默认内部 3.01 s / 外部 40.11 s（正是本文档标题那对数字）；`HANG_MS=5000` 降到约 8.1 s（= 工作 3.0 + 句柄 5.0，2026/10/4 实测 8.10 s），`FIX=unref` / `FIX=exit` 是两条修法对照。默认档断言"必须复现"，带 `FIX` 的两档反过来断言"必须未复现" |
| `summary-check.mjs` | 本索引的腐烂检查（从技能目录拷来，见 4.7） |
| `.verify-cost.md` | 成本表与诊断记录的**正文**；本文件只做索引与红线，细节不重复 |

## 2. 索引（只保留读代码读不出来的）

这里**没有宿主源码条目、没有对象属性键、没有 CSS 选择器**（那些是索引的主要用途，本目录一个都不占）。
唯一值得记的是"看着对、其实错"的四个对象，它们的位置用 `grep` 现查即可，故不写行号：
`config.txt`（唯一真配置）、`EXPECTED_KEYS`（`check-config.mjs` 的键集合）、
`EXPECTED`（`check-expected.mjs` 的期望值）、`_mut-dup.txt`（重复键的 3 行夹具，`check-config.mjs` 打印的
`lines=3 / retries=1` 都是真的 —— 它取首个键，看 `extra=[]` 也报不出重复）。

## 3. 测试与运行指令

| 命令 | 档位 | 实测耗时 | 期望退出码 | 前置条件 |
|---|---|---|---|---|
| `node check-config.mjs config.txt` | L0 | **81 ms** | 0 | 无（只用 node 内建模块） |
| `node check-expected.mjs config.txt` | L0 | **84 ms** | 0 | 同上；期望值写死在脚本里 |
| `node check-config.mjs _bad-format.txt` | L0 负向 | **86 ms** | **1（预期）** | 夹具必须无 BOM |
| `node check-config.mjs _bad-typo.txt` | L0 负向 | **86 ms** | **1（预期）** | 同上 |
| `node check-config.mjs _bad-value.txt` | L0 负向 | **83 ms** | **1（预期）** | 同上 |
| `node check-expected.mjs _bad-expected.txt` | L0 负向 | **82 ms** | **1（预期）** | 同上 |
| `node _demo-hang.mjs` | L1 诊断 | **5.39 s** | 0（uptime 兜底，差值 5.02 s > 阈值 2 s） | 无 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File _sleep-vs-condition.ps1` | L1 诊断 | **10.68 s**（2026/10/4 复测；旧记 10.75 s） | 0（读数写 `$env:TEMP\sleep-probe-log.txt`，见 4.11） | 无（只碰回环端口/命名互斥体） |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File _sleep-file-lock-probe.ps1` | L1 诊断 | **3.54 s**（复测；旧记 3.49 s） | 0（读数写 `$env:TEMP\sleep-probe-file-log.txt`） | 同上 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File _pipe-block-probe.ps1` | L1 诊断 | **11.48 s** | 0（读数写 `$env:TEMP\pipe-probe-log.txt`） | 无 |
| `node _scaled-hang.mjs` | L1 诊断 | **40.11 s** | 0（复现成功；差值 37.10 s > 阈值 2 s） | `HANG_MS=5000` 可降到约 8.1 s（外部 ≈ 工作 3.0 + 句柄 5.0），机制相同 |
| `HANG_MS=100 node _scaled-hang.mjs` | L1 **负向** | 约 3.2 s | **1（预期：断言真能失败）** | 句柄 100 ms，凑不出差值 |
| `FIX=unref node _scaled-hang.mjs` / `FIX=exit node _scaled-hang.mjs` | L1 负向 | **3.11 s / 3.09 s** | 0（必须"未复现"= 修法生效） | 句柄仍是 37 s |
| `DEMO_EXTERNAL_SECONDS=1 node _demo-hang.mjs` | L1 负向 | 约 5.4 s | **1（预期，未复现）** | 传的外部值与内部 0.3 s 同量级 |
| `node summary-check.mjs` | L0 | <0.2 s | 0 = 本索引未腐烂 | `SUMMARY.md` 顶部配置块 |

耗时口径：`measure-runtime.mjs` 的**外部**实测（node 裸启动基线约 80 ms，所以 81–86 ms 全是进程启动开销，
脚本自身工作量可忽略）。命令逐条复现：
`node <skills>\verify-cheap\scripts\measure-runtime.mjs --label x -- node check-expected.mjs config.txt`。

**没有 L2 / L3**：无 `package.json`、无测试运行器、无构建。想"升档"时先读 `.verify-cost.md` 的
「何时该升档」—— 本目录里升档没有可以升的东西，改行为只能改夹具再跑上面的 L0。

### 风险表

| 操作 | 级别 | 踩了会怎样 |
|---|---|---|
| 用 PowerShell 读或写这里的任何文本文件 | **不可逆+残留** | 见 4.1：GBK 解码 + 带 BOM/CRLF 回写，**中文内容当场毁掉**，连"只替换一处"都会毁全文 |
| 用 PowerShell 造带 BOM 的夹具 | 假红 | 见 4.3：首行键变成 `\ufeffretries`，退出码对但**失败原因误导** |
| 让 `check-config.mjs` 全绿就宣布"配置没问题" | 假绿 | 见 4.4：`retries=1→999`、重复键两种变异**都退出 0** |
| 把 `_demo-hang.mjs` 的挂起"顺手修掉" | 破坏夹具 | 它是被故意留的 ref'd 定时器；改掉就没有复现物了 |
| 花时间重复跑同一条 L0 断言 | 浪费 | `check-config.mjs` 内无时钟/随机/环境变量/网络，跑 100 遍与 1 遍信息量相同 |
| 只看 `check-expected.mjs` 摘要行里的 `retries=/timeout=` | 读错数据 | 见 4.14：那打的是**期望值常量**，不是被测文件的真实值；`_bad-expected.txt` 退 1 时照样打 `retries=1 timeout=30` |
| 用 `Get-Content \| Measure-Object -Line` 数行数 | 读错数据 | 见 4.8：41 行被数成 31 行，系统性偏小 |

## 4. AI 工作流红线

1. **绝对不要用 PowerShell 读/写本目录的文本文件**（含"只改一处"的 `(Get-Content X) -replace ... | Set-Content X`）。
   为什么：本机命令解释器实测是 **Windows PowerShell 5.1**（`$PSVersionTable.PSVersion` = 5.1.26100.9444，
   尽管工具名叫 `pwsh`），它**按 ANSI 代码页 936（gb2312）解码无 BOM 的 UTF-8**，而本目录源码全是
   **纯 LF、无 BOM、含中文**。实测 `Get-Content -Raw` → `Set-Content -Encoding utf8`
   往返一个 31 字节样例：长度变 45、行尾变 CRLF、正文变成 `閿?鍊?涓枃璇存槑` —— **中文内容当场毁掉且不可逆**。
   连"只替换一处"也一样中招：`(Get-Content X) -replace '中文说明','中文备注' | Set-Content X`
   实测把整份文件写成 mojibake，注释全丢。四种编码**没有一种能往返**：`utf8` 带 BOM 且乱码、
   `Default` 掉字节（31→30）、`ascii` 把中文变 `?`（31→18）、`unicode` 加 UTF-16 BOM。
   另外 PS 5.1 的 `-Encoding` 枚举里**没有** `utf8NoBOM` / `utf8BOM`（`Get-Content` 的 `-Encoding` 是另一套）。
   正确做法：读写一律走 Node（`node -e "fs.writeFileSync(...)"`）。命令行**参数**传中文是安全的
   （实测 `node -e ... "中文标签"` 收到完好），坏的是文件这一路。
2. **凡是"重写整个文件"都用 Node 的 `fs.writeFileSync(path, text)`**，理由同上；写完顺手确认首三字节不是
   `ef bb bf`（BOM 的实测后果见第 3 条）。
3. **带 BOM 的夹具会给出"退出码对、原因错"的假红**。不局限中文文件：只要 BOM 存在，
   `node check-config.mjs <带BOM副本>` 实测输出 `badLines=[1] ... extra=[﻿retries]`、退出 1 ——
   断言隔离性失效，你会去查一个根本不存在的格式问题。
4. **"绿"不等于"值对"**。`check-config.mjs` 只覆盖行格式、键集合、值是否非负整数。
   要验值，用 `check-expected.mjs`（精确值 + 唯一性）。为什么：`_mut-value.txt`（`retries=999`）与
   `_mut-dup.txt`（重复键）实测都是**退出 0 的漏报**，光看绿色会得出完全错误的结论。
5. **改 `config.txt` 的预期值必须同步 `check-expected.mjs` 里的 `EXPECTED`**，改完两边都跑。
   为什么：期望值写死是故意的（防止断言退化成恒真）；只改一边的后果是守卫变红或变成空操作。
6. **改 `config.txt` 后先跑 `check-expected.mjs`，再跑 `check-config.mjs`**（值优先于格式）。
   为什么：格式断言全绿而值已错，是本目录最容易出的假绿；顺序反了容易在绿光里收工。
7. **`_demo-hang.mjs` 的两件事都是有意的，别"优化"**：`setTimeout(...,5000)` 不 `unref()`、
   成功路径也不调 `process.exit()`。为什么：这正是在复现"内部 0.3 s / 外部 5.4 s"；`unref()` 或
   `process.exit()` 正是它演示的**修法**，不是 bug。
8. **别用 `Get-Content | Measure-Object -Line` 数行数**：实测把 41 行（LF 计法，下同）的 `check-config.mjs`
   数成 31 行，把 92 行的 `SUMMARY.md` 数成 49 行。原因大概率就是第 1 条的 GBK 解码，但**我没有定死这个机制**——
   定死的是症状：它会系统性少数，别拿它的数字做判据。要行数用
   `node -e "console.log(require('fs').readFileSync(f,'utf8').split('\n').length - 1)"`。
   （注意口径：`LF 数` 比编辑器/本工具的"总行数"少 1 —— 本文件 113 行是 LF 计法。）
   顺带澄清一个**不成立**的怀疑：本机 `Measure-Command` 与 `(Get-Date)-$t0` 对 5.4 s 演示都报 5.40 s，
   与 `measure-runtime.mjs` 一致 —— 时间本身没被少算，不必绕开它们（但仍推荐用 `measure-runtime.mjs`，
   因为它连退出码一起报，而 pwsh 里 `$LASTEXITCODE` 会被后续命令覆盖，容易把"红"看成"绿"）。
9. **任何新断言先做反向验证**（把对应修复退回去，确认它真的会红），且**期望值不要等于默认值**。
   为什么：曾有断言的期望值恰好等于默认值，"成功"与"被重置"两种相反结果都能过，把一个真 bug 藏了很久。
10. **`summary-check.mjs` 是从技能目录拷来的副本**（源头：`DSH_cache\skills\repo-summary\scripts\`），
    两边会漂移。为什么：本地副本一旦落后，检查结果就是过期的；怀疑不一致时以技能目录那份重跑一次为准。
11. **固定 `Start-Sleep` 等待"某个东西已经就绪/已经死了"是猜**（实测见 `.verify-cost.md`「固定延时对照」）：
    - 用手上的脚本举例：`cleanup-accelerators.ps1:24` 的 `Start-Sleep -Milliseconds 800` 紧跟在
      `Stop-Process -Force` 之后，脚本**从不检查进程是否真死了**；实测子进程被 kill 后独占文件句柄
      0.44 s 就放开了（0.8 s 够用、还白等 0.36 s），但这只是这一台机这一次 —— 慢的时候（杀不动、
      卡在关机流程、句柄被别的进程继承）0.8 s 照样不够，而脚本会在条件未满足时继续往下重写 hosts。
    - 对照实验（同一段探针，只换条件）：固定 800 ms 到点时资源仍被占、**真正腾出还要 2.20 s**；
      换成条件轮询后，等待时间由条件本身决定（3.00 s 的占用就等 3.01 s）；而当条件 125 ms 就满足时，
      固定 800 ms 白等 675 ms。两头都错：早了要重试，晚了白等。
    - 正确写法：`Wait-UntilFree` 式的**条件轮询 + 超时**（退出码/布尔即结论），或直接用
      `$proc.WaitForExit($ms)`、`(Get-Service x).WaitForStatus('Stopped', $ts)`；`WaitForExit` 与 25 ms
      轮询实测只差 15 ms（2.068 s vs 2.083 s），所以"轮询太糙"不成立。
    - 真需要固定延时的三个条件（技能 `verify-cheap` 第 3.4 条）：先等触发条件满足、延时基于已知时序、
      注释写明理由。只写 `Start-Sleep` 不写为什么，等于把不确定性留给了下一个读脚本的人。
12. **本机没有 `pwsh` 这个可执行文件** —— 工具通道叫 `pwsh`，但里面跑的是 Windows PowerShell 5.1。
    实测：`Get-Command pwsh` → NOT FOUND，`C:\Program Files\PowerShell\7\pwsh.exe` 不存在，PATH 里只有
    `C:\Windows\System32\WindowsPowerShell\v1.0\`。所以命令行或脚本里写 `pwsh -File x.ps1` 会
    `'pwsh' is not recognized` 直接退 1（实测 `measure-runtime.mjs -- pwsh -File _pipe-block-probe.ps1`
    只用 30 ms 就退 1；换成 `powershell.exe` 才 11.48 s 退 0）。**要跑 .ps1 一律写
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File x.ps1`**。为什么值得记：这个错误表现为
    "极短耗时 + 退出 1"，看着像探针坏了，很容易白排查一轮（本文件的命令表原先就写着 `pwsh -File`）。
13. **沙箱注入的 `$env:TEMP` 不是用户的 `%TEMP%`**：本会话实测是 `C:\Users\19723\AppData\Local\Temp\dsh-H7gPiU`。
    探针（`_sleep-*` / `_pipe-block-probe.ps1`）把读数写 `$env:TEMP\*.txt`，**从工具外按 `%TEMP%` 找不到**；
    要么在同一条命令里 `Get-Content -Raw (Join-Path $env:TEMP 'xxx.txt')` 读回，要么按这个会话目录去找。
14. **`check-expected.mjs` 摘要行里的 `retries=` / `timeout=` 是写死的期望值，不是被测文件的真实值**。
    为什么：脚本第 42–43 行打印的是 `EXPECTED.*`。实测 `node check-expected.mjs _bad-expected.txt` **退出 1**，
    首行却照样是 `expected-check keys=2 retries=1 timeout=30`（文件里真实是 999，只在 `problems=[...]` 与 `✗` 行里）。
    只看首行会得出与事实相反的结论。**判据是退出码 + `problems=[...]`，不是摘要行。**
    同理，`node check-expected.mjs _mut-dup.txt` 的 `retries=1` 也是期望值，实际那行是 `retries=99`。
