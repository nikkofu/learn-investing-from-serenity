import { NextRequest, NextResponse } from "next/server";
import { runEveningScan, generateEmailHtml, generateEmailText, type EveningScanConfig } from "@/lib/eveningScan";
import { sendAgentlyMail, type AgentlyMailConfig } from "@/lib/agentlyMailer";
import { loadEmailConfig } from "@/lib/config";

export async function POST(request: NextRequest) {
  try {
    // 加载邮件配置
    const emailConfig = await loadEmailConfig();
    
    if (!emailConfig || !emailConfig.senderEmail || !emailConfig.recipientEmail) {
      return NextResponse.json(
        { error: "邮件配置未完成，请先配置发件人和收件人邮箱" },
        { status: 400 }
      );
    }

    // 从配置中获取筛选条件
    const scanConfig: EveningScanConfig = emailConfig.filters || {
      requireUptrend: true,
      maxBSignalAgeDays: 5,
      minExpectedReturn: 35,
      maxChannelPosition: 0.15,
      maxResults: 10,
      enableAdaptiveRelaxation: true,
    };

    // 执行扫描
    const scanResult = await runEveningScan(scanConfig);

    // 生成邮件内容
    const htmlContent = generateEmailHtml(scanResult);
    const textContent = generateEmailText(scanResult);

    // 发送邮件
    const mailConfig: AgentlyMailConfig = {
      to: emailConfig.recipientEmail,
      subject: `📈 Serenity 晚间精选股票池 - ${scanResult.date}`,
      html: htmlContent,
      text: textContent,
    };

    const mailResult = await sendAgentlyMail(mailConfig);

    if (!mailResult.success) {
      return NextResponse.json(
        { error: "邮件发送失败: " + (mailResult.error || "未知错误") },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      scanResult: {
        date: scanResult.date,
        totalScanned: scanResult.totalScanned,
        filteredCount: scanResult.filteredCount,
        stocksCount: scanResult.stocks.length,
        usedRelaxedCriteria: scanResult.usedRelaxedCriteria,
      },
    });
  } catch (error) {
    console.error("晚间扫描执行失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "扫描执行失败" },
      { status: 500 }
    );
  }
}
