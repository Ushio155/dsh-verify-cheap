# 探针写法（probe-cookbook）

L1 探针的目标：用最小代价回答"当前运行时里某个值 / 样式 / 状态是多少"。原则与具体技术栈无关，下面的命令只是可替换的实现样例。文中路径均相对本技能目录（`skills/verify-cheap/`）。

## 一、何时用探针

- 静态阅读无法确定取值：真实布局尺寸、运行时状态、注入结果、事件顺序。
- 只需要一个事实，不需要走完整流程。
- 运行环境可以启动（应用 / 服务器 / 页面）。

## 二、通用约束

1. 一个片段只回答一个问题，不顺手扩展成回归套件。
2. 就绪判断用条件轮询 + 超时，不用固定延时。典型场景是两阶段等待：先等环境就绪，再等被测对象出现。
3. 输出保持最小：默认只打印目标值与 warning / error，其余噪声屏蔽。
4. 片段落地为文件再运行，便于复用与复现，避免超长内联命令。
5. 退出前关闭页面 / 连接 / 定时器，否则外部耗时会明显大于内部计时。

## 三、实现样例

### 单值探针（Node）

```js
// probe-value.mjs
const started = Date.now();
const value = await readValue();        // 替换为真实取值逻辑
console.log(JSON.stringify({ value, ms: Date.now() - started }));
process.exit(0);                        // 避免事件循环挂起，见 anti-patterns.md 第 5 条
```

### 条件就绪 + 超时（库调用）

```js
import { waitUntil } from "./scripts/wait-until.mjs";   // 路径相对本技能目录
await waitUntil(() => isReady(), { timeoutMs: 60_000, intervalMs: 500, label: "被测对象就绪" });
```

### 命令行等待与计时

```powershell
node scripts/wait-until.mjs --timeout 120 -- npm run build
node scripts/wait-until.mjs --timeout 90  --file out/index.js
node scripts/wait-until.mjs --timeout 30  --port 3080
node scripts/measure-runtime.mjs --label "L2 单套件" -- npm test -- --grep "inject"
```

### PowerShell 等价写法

```powershell
# 一次性求值：保持单行，避免嵌套引号
node -e "console.log(process.version)"

# 条件轮询，代替 Start-Sleep
node scripts/wait-until.mjs --timeout 90 -- pwsh -NoProfile -Command "Test-Path out/index.js"
```

## 四、探针外壳应具备的能力

跨技术栈通用，实现方式按环境选择：

- 两阶段就绪等待：环境启动就绪 → 被测对象挂载完成。
- 默认只转发页面 / 进程的 warning 与 error 级别输出。
- 可选截图或产物输出，便于人工确认。
- 接收一个片段文件作为参数，外壳保持稳定，片段按需替换。
- 退出前关闭页面、连接与定时器，避免外部耗时虚高。

## 五、本机现有探针外壳（示例）

`SillyTavern_plugin\LoreMemory-Plugin\.lorememory-test\ui-probe.mjs` —— 单页 CDP 探针外壳：两阶段就绪等待、默认只转发页面 warning / error、`--shot` 输出截图，用法 `node ui-probe.mjs 片段.js [--shot 出图.png]`。

该路径只是本机的一个实现示例；换环境时按第四节能力清单重新实现或用更轻的探针替代，不要沿用硬编码路径。
