# Learn Investing from Serenity · 瓶颈点投研台

把 X 博主 **Serenity（@aleabitoreddit，“白毛股神”）** 的 **瓶颈点投资法 (Chokepoint Investing)** 系统化，结合可配置的 OpenAI 兼容 LLM 与 A 股公开行情数据，用于学习其投资技巧、拆解产业链、对个股做瓶颈点评分。

> ⚠️ **免责声明**：本项目仅供学习研究，**不构成任何投资建议 (NFA)**。Serenity 自报收益未经第三方审计。

纯 TypeScript / Next.js（App Router）全栈，无需 Python。

## 功能

- **方法论 / 知识库**：拆解 Serenity 的瓶颈点五因子框架、交易原则、主题 → A 股映射（代码经东方财富接口校验），并展示从 X 抓取的历史发言。
- **趋势 → 产业链拆解**：输入一个趋势（如“AI 算力 / 光模块”），AI 按瓶颈点方法拆出产业链分层并标注 A 股“卡脖子”环节。
- **个股瓶颈点分析**：搜索 A 股（名称/代码/拼音）→ 拉取实时行情与 K 线 → AI 按五因子打分 + 生成 Serenity 风格论述、催化剂、风险。
- **设置**：填写任意 OpenAI 兼容服务（provider / base URL / model / API key），保存在服务端本地，**不入库**。

## 五因子框架

| 因子 | 权重 | 含义 |
|---|---|---|
| 确定需求 Confirmed Demand | 20% | 下游趋势被验证、需求明确持续 |
| 受限供给 Constrained Supply | 30% | “没它不行”、短期难替代（**瓶颈核心**） |
| 低关注度 Low Attention | 15% | 市场认知滞后、估值未反映 |
| 价值捕获 Value Capture | 20% | 定价权、毛利率、客户锁定、份额 |
| 催化剂 Catalyst | 15% | 财报、量产、政策、指数纳入、大单 |

详见 [`knowledge/serenity-methodology.md`](knowledge/serenity-methodology.md) 与 [`data/serenity_knowledge.json`](data/serenity_knowledge.json)。

## 快速开始

```bash
npm install
npm run dev    # http://localhost:3000
```

打开 `/settings` 填写 LLM 配置（如 DeepSeek / OpenAI / 通义千问 等任意 OpenAI 兼容服务），即可使用「产业链拆解」与「个股分析」。

也可用环境变量代替（见下）。

## LLM 配置

设置页保存到 `.data/llm-config.json`（已 gitignore）。或用环境变量：

```bash
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
export OPENAI_MODEL="deepseek-chat"
export OPENAI_API_KEY="sk-..."
```

## 数据来源

| 用途 | 来源 | 备注 |
|---|---|---|
| 股票搜索 | 东方财富 searchadapter | 名称/代码/拼音 |
| 实时行情 + PE/PB/市值 | 腾讯财经 `qt.gtimg.cn` | GBK 解码 |
| 日 K 线 | 东方财富 `push2his` | best-effort，失败不影响分析 |
| 知识库 | X @aleabitoreddit 公开时间线 | 见下方脚本 |

## 抓取 Serenity 的 X 知识库

`scripts/scrape-x.mjs` 通过 CDP 连接已运行的 Chrome，滚动抓取公开时间线到 `.data/x-posts.json`（含第三方内容，默认 gitignore，不入库）。

```bash
node scripts/scrape-x.mjs aleabitoreddit 60
```

抓取后，首页与方法论页会自动展示其高频标的与近期发言。

> Reddit (u/AleaBito) 为其早期资料，但部分网络环境对 Reddit 有访问限制；如需可在浏览器登录后再抓取。

## 技术栈

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · `openai` SDK（OpenAI 兼容）· `playwright-core`（抓取）。

## 目录

```
src/lib/         数据层、LLM 客户端、瓶颈点评分、知识库加载
src/app/api/     config / market / analyze / map / knowledge 路由
src/app/         概览 / 方法论 / 产业链 / 个股 / 设置 页面
data/            curated 知识库（可入库，无密钥）
knowledge/       方法论拆解 markdown
scripts/         X 抓取脚本
```
