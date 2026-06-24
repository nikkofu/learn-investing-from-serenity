# Serenity 智能投研台项目指令指南

本项目是一个基于 Next.js 与 TypeScript 开发的全栈应用。为了保障代码的健壮度与规范性，请在日常开发与迭代中遵循以下指令指南：

## 🚀 常用开发命令
* **本地开发服务启动**: `npm run dev` (本地服务运行在 `http://localhost:3000`)
* **生产环境构建打包**: `npm run build`
* **启动打包后的服务**: `npm run start`

## 🛡️ 日常代码质量检查
在执行代码合并、Git 提交或发布新版本前，**必须**跑通以下两项质量核验命令：
1. **代码风格与规范检查 (ESLint)**:
   ```bash
   npm run lint
   ```
   * 自动核验项目中的代码规范、Next.js 最佳实践、及 React/ESLint 推荐规则。
2. **强类型安全与编译器检查 (TypeScript Compiler)**:
   ```bash
   npm run type-check
   ```
   * 执行完整的 TypeScript 全局类型安全核验（`tsc --noEmit`），确保无类型兼容问题、隐式 null 指针异常或未使用的 imports。

## 📝 代码与提交规范
* **语言规范**：项目内的所有代码注释、文档描述（如 `CHANGELOG.md`、`README.md`）及 Git 提交信息，请遵循项目指南，统一采用**简体中文**编写。
* **发布版本流程**：在发版前需先升级 `package.json` 版本号，然后在 `CHANGELOG.md` 记录详细更新条目，编译打包通过后推 tagged 标签。

---
*关联开发代理规则请参阅项目根目录下的 `AGENTS.md`。*
