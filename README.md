# dsh-verify-cheap

一个 DSH 插件，内容只有一份技能：**用最低成本验证改动**。安装时把包内的 `skills/` 注册为一个技能根，于是这份技能随插件进入 agent 的技能目录。

An installable DSH plugin that carries one skill: **verify a change with the cheapest check that still yields a definite answer**. Installing it registers the package's own `skills/` directory as a skill root.

```sh
dsh plugin --profile web add github:Ushio155/dsh-verify-cheap
```

> 技能正文是中文；`SKILL.md` 的 description 也是中文（它决定触发）。脚本本身与语言无关，可脱离 DSH 单独使用。
> The skill body is written in Chinese, as is its frontmatter `description` (that text is the trigger surface). The bundled scripts are language-agnostic and run outside DSH.

## 技能覆盖什么

- **成本阶梯 L0–L3**：静态检查 / 探针 / 单个测试套件 / 全量，各自典型耗时与适用场景，以及怎么按"改的是行为还是表现"选档
- **不要用固定延时等后台作业**：条件轮询 + 超时；确实需要固定延时的三个并列条件（否则就是猜）
- **断言必须能失败**：举不出失败场景的断言等价于没有验证；优先断言具体取值而不是"存在 / 不为空 / 小于 N"
- **耗时必须实测**：脚本要打印分段耗时表，并同时给出外部总时长与脚本内计时 —— 两者差距明显说明有句柄 / 连接 / 定时器挂在事件循环上
- **把坑沉淀给下一个会话**：读代码读不出来的事实要落进该仓库的长期索引，而不是 README 或阶段笔记
- **何时不该用 / 直接跳档**：改动触及公共代码或构建配置 → 直接 L3，不必先走 L0 试探；探索性调试先弄清问题再选档；安全、并发、时序类改动静态检查置信度极低，直接从 L2 起步
- **成本表落位**：每次验证记三项（档位 / 实测耗时 / 能否再降一档），表落在仓库根 `.verify-cost.md`；仓库已有 `SUMMARY.md` 这类索引时并进其中「成本表」小节

## 布局

```
package.json        # dsh.bundle.patch → cordis.patch.yml
cordis.patch.yml    # 插入一行 @deepseek-ai/dsh-skill-filesystem，customSkillDirs 指向 skills/
skills/
  verify-cheap/
    SKILL.md
    references/
      anti-patterns.md        # 恒真断言、等价反模式、手写轮询的两个坑
      cost-measurement.md     # 计时实现、内外差异判定、成本表模板
      probe-cookbook.md       # 探针外壳规范与各技术栈写法
    scripts/
      wait-until.mjs
      measure-runtime.mjs
research/
  trigger-ab/         # 「description 会不会真的触发技能」的 A/B 实验归档（脚本 + 原始结果 + 夹具）
```

> `research/trigger-ab/` 是实验归档，**不属于插件内容**（`package.json` 的 `files` 不含它）：7 个 harness 在同一个夹具工作区里反复跑 `dsh --profile headless`，只看模型有没有调用 `skill(verify-cheap)`、以及**第一次工具调用**是不是它。结论是 `description` 里的具体动作词决定"第一步就加载"（skill-first 6/8 vs 1/8，Fisher 双侧 p=0.041），而再往 `AGENTS.md` 里补一句"验证类任务先加载技能"没有可测增量。矩阵、逐次运行的调用序列与那次实验的 175 个会话清单都在该目录里。

`cordis.patch.yml` 用 `createRequire(baseUrl).resolve('<包名>/package.json')` 定位本包目录，再把 `skills/` 拼上去 —— 这与 DSH 自带 agent preset 装载自己技能用的是同一套写法。`providerName` 必须每包唯一——技能注册表拒绝同名 provider，所以默认值 `filesystem` 会和 harness 自带 provider 以及任何用同一机制的插件撞名；`includeDefaultRoots: false` 让这个 provider 只管自己的目录（project / user 根由 harness 自带 provider 负责，不用重复声明）。

> ⚠️ **不要用 `new URL('skills/', baseUrl)` 那种写法。** `baseUrl` 锚在 **profile 目录**，不是包目录；那种写法会静默指向 `<profile>/skills`，目录不存在，于是一个技能都加载不出来，**而且不报错**。
>
> 这条是实测出来的，不是推断：在同一个已安装的 profile 里，
> ① 按 `new URL` 写，放一个只存在于包内的探针技能 → 技能目录里**看不到**；
> ② 只改这一行成 `createRequire` 写法 → 探针**立刻出现**；
> ③ 删掉探针 → 又**消失**。
> 同 profile、同安装、同提问，唯一变量是那一行。若你的技能装上了却"没生效"，先查这里。

## `peerDependencies` 用的是 `"*"`，理由如下

官方 `@deepseek-ai/*` 包按 awesome-dsh-plugin 贡献指南的建议声明为 `peerDependencies` 而非 `dependencies`，范围写 `"*"`。

但 `"*"` 在**裸 semver** 下并不匹配预发布版本。实测（npm 自带的 semver 库）：

```
semver.satisfies('0.1.7-rc.2', '*')                              → false
semver.satisfies('0.1.7-rc.2', '*', { includePrerelease: true }) → true
semver.satisfies('0.1.7-rc.2', '>=0.1.0-rc.1 <0.2.0-0')          → false   ← 指南推荐的写法也失效
semver.satisfies('0.1.7-rc.2', '>=0.1.7-rc.1 <0.2.0-0')          → true
```

而本机装的 harness 正是预发布版本：`@deepseek-ai/dsh-skill-filesystem@0.1.7-rc.2`（`cordis` 是稳定的 `4.0.4`）。

- 贡献指南给的 `||` 分支写法（`>=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.2.0-0`）确实修好了它举的那个例子，但**只覆盖被写明元组的那一个版本**：`0.1.7-rc.2` 依然不满足，因为该范围里没有任何 `0.1.7` 元组上的预发布比较符。照抄它，就会在 harness 下一次 rc 跳元组时把一个真实环境静默排除掉。
- 所以这里保留 `"*"`，并把这条当作已记录的已知事实，而不是加一个会随时间腐坏的范围。实测 `dsh plugin add github:Ushio155/dsh-verify-cheap` 安装成功、技能正常加载 —— 即该 peer 范围未被判定为不满足（pnpm 是不满足时只告警、还是按 `includePrerelease` 判定，没有进一步区分）。

结论：在 DSH 插件里写死 `@deepseek-ai/*` 的预发布范围，比写 `"*"` 更危险。

## 两个脚本（零依赖，Node >= 18）

两个脚本都不依赖任何第三方包（只用 `node:` 内建模块），可以脱离 DSH 直接跑。它们自身只做等待与计时；被执行的是你传给它们的命令。

### `wait-until.mjs` —— 条件轮询 + 超时

替代脚本内的固定延时：每次尝试都重新判断条件，条件满足即刻返回，超时则失败退出，因此不会出现"条件早满足要重试、晚满足就白等"。

```sh
node skills/verify-cheap/scripts/wait-until.mjs --timeout 120 -- npm run build
node skills/verify-cheap/scripts/wait-until.mjs --timeout 90 --file out/index.js
node skills/verify-cheap/scripts/wait-until.mjs --timeout 30 --port 3080
node skills/verify-cheap/scripts/wait-until.mjs --timeout 120 --match "listening on" -- npm run dev
```

也可以当库用：

```js
import { waitUntil } from '<plugin-dir>/skills/verify-cheap/scripts/wait-until.mjs';
await waitUntil(() => isReady(), { timeoutMs: 60_000, intervalMs: 500, label: '被测对象就绪' });
```

退出码：`0` 条件已满足 / `1` 超时 / `2` 参数错误。`--match` 需要捕获子进程 stdout，在禁止管道 stdio 的受限沙箱中不可用（脚本会用 `--help` 说明这一点）。

### `measure-runtime.mjs` —— 实测耗时

两种用法：

**CLI 模式**测任意命令的**外部总时长**（从子进程启动到退出），退出码透传子进程退出码，无法启动时为 `127`：

```sh
node skills/verify-cheap/scripts/measure-runtime.mjs --label "L2 集成测试" -- npm test
node skills/verify-cheap/scripts/measure-runtime.mjs --json -- pwsh -File build.ps1
```

**库模式**才提供分段耗时与内外对比 —— 按 `[小节]` 边界打印分段表，并同时给出外部总时长与脚本内计时，把两者差值标出来。汇报耗时可以直接引用它，而不是凭印象：

```js
import { createTimer } from '<plugin-dir>/skills/verify-cheap/scripts/measure-runtime.mjs';
const timer = createTimer('L2 注入回归');
timer.start('prepare');
// ... 被测工作 ...
timer.end('prepare');
await timer.section('run', async () => { /* ... */ });
timer.report({ exit: 0 });   // 省略 exit 则不退出进程
```

报告之后进程若仍存活，退出钩子会补测那段耗时并告警 —— 这正是"有句柄 / 连接 / 定时器挂在事件循环上"的常见表现。

## License

MIT
