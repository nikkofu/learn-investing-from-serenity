#!/usr/bin/env tsx

/**
 * 晚间股票扫描脚本
 * 
 * 用法：
 * 1. 手动执行: npx tsx scripts/evening-scan.ts
 * 2. 集成到定时任务: 参见 src/lib/scheduler.ts
 */

import { runEveningScan, generateEmailHtml, generateEmailText, type EveningScanConfig } from "../src/lib/eveningScan";
import { sendAgentlyMail, type AgentlyMailConfig } from "../src/lib/agentlyMailer";
import { loadEmailConfig } from "../src/lib/config";

async function main() {
  console.log("========================================");
  console.log("🚀 开始晚间股票扫描");
  console.log("========================================");

  try {
    // 0. 加载邮件配置
    console.log("\n⚙️  步骤0: 加载邮件配置...");
    const emailConfig = await loadEmailConfig();
    
    if (!emailConfig || !emailConfig.senderEmail || !emailConfig.recipientEmail) {
      console.error("❌ 邮件配置未完成，请在设置页面配置发件人和收件人邮箱");
      console.error("   发件人邮箱需要先在 agent.qq.com 完成授权");
      process.exit(1);
    }
    
    console.log(`✅ 邮件配置加载完成:`);
    console.log(`   发件人: ${emailConfig.senderEmail}`);
    console.log(`   收件人: ${emailConfig.recipientEmail}`);
    
    // 从配置中获取筛选条件
    const scanConfig: EveningScanConfig = emailConfig.filters || {
      requireUptrend: true,
      maxBSignalAgeDays: 5,
      minExpectedReturn: 35,
      maxChannelPosition: 0.15,
      maxResults: 10,
      enableAdaptiveRelaxation: true,
    };
    
    console.log(`   筛选条件:`, scanConfig);

    // 1. 执行扫描
    console.log("\n📊 步骤1: 执行股票扫描...");
    const scanResult = await runEveningScan(scanConfig);
    
    console.log(`✅ 扫描完成:`);
    console.log(`   - 扫描日期: ${scanResult.date}`);
    console.log(`   - 总扫描数量: ${scanResult.totalScanned} 只`);
    console.log(`   - 符合条件: ${scanResult.filteredCount} 只`);
    console.log(`   - 精选股票: ${scanResult.stocks.length} 只`);
    
    if (scanResult.usedRelaxedCriteria) {
      console.log(`   - 使用了放宽条件: 是`);
      console.log(`   - 放宽后条件:`, scanResult.relaxedCriteria);
    }

    if (scanResult.stocks.length > 0) {
      console.log("\n🏆 精选股票列表:");
      scanResult.stocks.forEach((stock, index) => {
        console.log(`   ${index + 1}. ${stock.name} (${stock.code})`);
        console.log(`      现价: ¥${stock.price.toFixed(2)} | 预期涨幅: +${stock.expectedReturnBase.toFixed(1)}% | 盈亏比: ${stock.riskReward.toFixed(2)}`);
      });
    }

    // 2. 生成邮件内容
    console.log("\n📧 步骤2: 生成邮件内容...");
    const htmlContent = generateEmailHtml(scanResult);
    const textContent = generateEmailText(scanResult);
    console.log("✅ 邮件内容生成完成");

    // 3. 发送邮件
    console.log("\n📮 步骤3: 发送邮件...");
    console.log(`   发件人: ${emailConfig.senderEmail}`);
    console.log(`   收件人: ${emailConfig.recipientEmail}`);
    
    const mailConfig: AgentlyMailConfig = {
      to: emailConfig.recipientEmail,
      subject: `📈 Serenity 晚间精选股票池 - ${scanResult.date}`,
      html: htmlContent,
      text: textContent,
    };

    const mailResult = await sendAgentlyMail(mailConfig);

    if (mailResult.success) {
      console.log("✅ 邮件发送成功!");
    } else {
      console.error("❌ 邮件发送失败:", mailResult.error);
      process.exit(1);
    }

    console.log("\n========================================");
    console.log("🎉 晚间股票扫描完成");
    console.log("========================================");

  } catch (error) {
    console.error("\n❌ 执行过程中出错:", error);
    process.exit(1);
  }
}

// 运行主函数
main();