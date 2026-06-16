# 🚀 Learn Investing from Serenity · 瓶颈点智能投研台

> **把“白毛股神”的供应链卡脖子投资学，变成你的自动化选股武器。**

[![Next.js](https://img.shields.io/badge/Framework-Next.js%2016-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/Library-React%2019-blue?style=for-the-badge&logo=react)](https://react.dev)
[![Tailwind v4](https://img.shields.io/badge/CSS-Tailwind%20v4-38bdf8?style=for-the-badge&logo=tailwind-css)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

**Serenity 瓶颈智能投研台** 是一款将 X 顶级半导体与算力供应链分析师 **Serenity（@aleabitoreddit，“白毛股神”）** 的 **“瓶颈点投资法 (Chokepoint Investing)”** 系统化的全栈选股与投研台。我们结合了最先进的大语言模型与 A 股实时行情数据，协助投资者深度拆解产业链，定位那些低关注度、高定价权的上游隐形冠军。

> ⚠️ **免责声明**：本项目仅供学习与研究之用，**不构成任何投资建议 (NFA)**。股市有风险，入市需谨慎。

---

## ✨ 核心亮点

### 💡 瓶颈点投资法自动化
告别昂贵的研报与繁琐的产业链核对。输入任何大趋势，AI 将按照五因子评估框架自动对个股进行科学量化打分，识别真正的卡脖子标的：
*   **确定需求 (Confirmed Demand - 20%)**：验证下游景气度是否明确且具备持续性。
*   **受限供给 (Constrained Supply - 30%)**：**瓶颈核心！**短期内难以复制、没它不行的核心壁垒。
*   **低关注度 (Low Attention - 15%)**：寻找未被市场充分定价、估值尚处洼地的冷门环节。
*   **价值捕获 (Value Capture - 20%)**：评估产品定价权、毛利率、客户绑定深度与市场份额。
*   **催化剂 (Catalyst - 15%)**：捕捉财报、量产、核心招标、指数纳入等重估节点。

### 🎨 沉浸式专业投研美学（全新升级！）
我们精心设计了 **8 套极具专业感与科技感的配色主题**。新增的渐变与毛玻璃（Glassmorphism）效果让数据分析界面如同高端金融杂志般高贵精美：
*   **极光冰川 (`aurora-frost`)**：深邃的冰川夜空渐变，配以高透光卡片与极光冰蓝强调色，冷静深邃。
*   **熔岩赤金 (`lava-gold`)**：熔岩黑底色搭配香槟赤金的斜角渐变，超大字号数据展示，视觉张力拉满。
*   **雨林寒露 (`rainforest-mist`)**：微粉浅灰底色，温润森绿斜角渐变强调色，呈现清新高级的学术研究氛围。
*   **冰川极光 (`glacier-aurora`)**：清冷理性的浅冰蓝底色，模拟现代金融科技报告的干净与理智。
*   **香槟宣纸 (`champagne-scroll`)**：温润的宣纸米黄搭配琥珀朱砂红强调色，国风底蕴，凸显长线投资价值。

### 📸 爆款社交分享海报生成器（全新核心功能！）
一键生成专为**小红书、X.com (Twitter)、Meta (Facebook)** 设计的专业报道海报，帮您的研报迅速在社交圈引流破圈：
*   **双比例自适应**：支持 **9:16 黄金竖版**（完美适配小红书笔记 / Story）与 **16:9 经典横版**（适合 X 平台发布）。
*   **大博主设计板式**：卡片内置 Serenity 卡通头像，配有博主资质栏、超大评分徽章、高保真 SVG 因子雷达图以及独特的“Serenity 投资论述金句引用卡”。
*   **不透明蒙版菜单**：配色切换覆层专门设计了不透明底色变量 `--popover-bg`，杜绝文字重叠叠加。
*   **2倍超清 PNG 导出**：采用 `html-to-image` 离线渲染，直接点击即可下载超清大图。

### 📊 双策略量化诊断与中长期阻尼趋势预测（全新核心功能！）
我们为个股深度量化诊断开发了业界领先的多策略回测、中长期走势发散预测模型以及深度的双向联动交互：
*   **双回测策略诊断**：支持“传统均线突破”与“Serenity 瓶颈动量突破”双策略回测。删除了低于 55 分的一刀切硬性交易屏蔽（降级为风险防御警示），并引入了 VCP（波动收缩）窄幅箱体整理放量二波起爆检测算法，彻底解决在最后一次卖出后不再买入、因窄幅整理而踏空主升浪的 Bug。
*   **3个月（60交易日）阻尼趋势预测**：将未来股价预测天数从 15 天大幅度扩充至 60 天（3个月），并引入金融工程中的指数级阻尼均值回归趋势预测模型，使得中长期预测既具备符合布朗运动的喇叭口发散特性，又避免了线性斜率发散极化造成的暴涨暴跌。
*   **牛熊生命均线系统 (MA120/MA250)**：支持 120日半年线（紫色）和 250日年线（红色）的动态计算与 Toolbar 控制开关，并在十字光标滑动时在顶部对准输出。
*   **K线与筹码分布双向深度联动交互 (Elite UX)**：
    *   *左向右（日期级联动）*：在 K 线图上滑动鼠标，右侧筹码直方图实时对当前历史日期重新计算衰减分布，直观呈现主力筹码演变，且水平线平移并更名为“收盘: XX.XX”。
    *   *右向左（价格线联动）*：鼠标 hover 右侧筹码柱时，左右两侧图表将同步渲染该价格的水平虚线，并在左侧 Y 轴生成带背景的价格数字气泡，极大增强了将筹码密集带与历史 K 线关键支撑阻力位比照研判的交互体验。

---

## 🛠️ 技术栈

*   **前端框架**：Next.js 16 (App Router) · React 19
*   **样式体系**：Tailwind CSS v4 (含 PostCSS 处理)
*   **语言支持**：TypeScript
*   **海报渲染**：`html-to-image` 无损导出
*   **数据采集**：`playwright-core` (用于抓取 X 一手发言)
*   **行情来源**：东方财富 + 腾讯财经公开行情接口

---

## 🚀 快速开始

### 1. 安装与本地启动
```bash
npm install
npm run dev    # 本地服务已自适应运行在 http://localhost:3000 或 http://localhost:3001
```

### 2. 配置大语言模型
打开浏览器，导航至 `/settings`（设置页），填入您的任意 OpenAI 兼容服务（例如 OpenAI, DeepSeek, OpenRouter, 通义千问等）：
*   **Provider**：如 `DeepSeek`
*   **Base URL**：如 `https://api.deepseek.com/v1`
*   **Model**：如 `deepseek-chat`
*   **API Key**：`sk-...` (API key 仅存储在您的本地服务端 `.data/llm-config.json` 中，绝不会泄露回传至浏览器)

配置好后，即可立即解锁**产业链拆解**与**个股五因子打分分析**功能。

---

## 📂 项目结构说明

```
├── src/
│   ├── app/                # 路由页面（首页、方法论、产业链、个股分析、LLM设置）
│   │   └── api/            # 服务端 API（配置读写、实时行情、AI评分流程、NDJSON流推送）
│   ├── components/         # 核心组件（ThemeSwitcher 配色管理器、SharingCard 分享海报生成器等）
│   ├── lib/                # 数据处理层（LLM 客户端、评分算法、行情 GBK 解析、东财接口等）
├── public/                 # 静态资源（含 Serenity 卡通头像）
├── knowledge/              # markdown 格式的方法论拆解库
├── scripts/                # 自动化抓取脚本
```

---

## 🤝 贡献与反馈

欢迎提交 Issue 或 Pull Request！我们致力于将本项目打造为最符合投资者直觉、美观度与易用性极佳的开源投研台。

*如果你喜欢这个项目，不妨给它点一个 ⭐ Star，感谢你的支持！*

