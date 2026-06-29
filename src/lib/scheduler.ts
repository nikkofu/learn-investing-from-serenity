import * as cron from "node-cron";
import { runEveningScan, generateEmailHtml, generateEmailText, type EveningScanConfig } from "./eveningScan";
import { sendAgentlyMail, type AgentlyMailConfig } from "./agentlyMailer";
import { loadEmailConfig } from "./config";
import type { ScheduledTask } from "node-cron";

export interface SchedulerConfig {
  /** cron 表达式（默认每天晚上20:00执行） */
  cronSchedule?: string;
  /** 时区（默认 Asia/Shanghai） */
  timezone?: string;
  /** 晚间扫描配置 */
  scanConfig?: EveningScanConfig;
}

class EveningScanScheduler {
  private task: ScheduledTask | null = null;
  private config: SchedulerConfig;
  private isRunning: boolean = false;

  constructor(config: SchedulerConfig = {}) {
    this.config = {
      cronSchedule: "0 20 * * *", // 每天20:00
      timezone: "Asia/Shanghai",
      ...config,
    };
  }

  /**
   * 启动定时任务
   */
  start(): void {
    if (this.task) {
      console.log("定时任务已经在运行中");
      return;
    }

    console.log(`启动晚间扫描定时任务: ${this.config.cronSchedule} (${this.config.timezone})`);

    this.task = cron.schedule(
      this.config.cronSchedule!,
      () => {
        this.runScan().catch((error) => {
          console.error("定时扫描执行失败:", error);
        });
      },
      {
        timezone: this.config.timezone!,
      }
    );

    console.log("定时任务已启动");
  }

  /**
   * 停止定时任务
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log("定时任务已停止");
    }
  }

  /**
   * 手动触发一次扫描（用于测试）
   */
  async runScan(): Promise<void> {
    if (this.isRunning) {
      console.log("扫描任务正在执行中，跳过本次");
      return;
    }

    this.isRunning = true;
    console.log("开始执行晚间股票扫描...");

    try {
      // 0. 加载邮件配置
      console.log("步骤0: 加载邮件配置...");
      const emailConfig = await loadEmailConfig();
      
      if (!emailConfig || !emailConfig.senderEmail || !emailConfig.recipientEmail) {
        console.error("邮件配置未完成，跳过本次扫描");
        console.error("请在设置页面配置发件人和收件人邮箱");
        return;
      }
      
      console.log(`邮件配置: 发件人=${emailConfig.senderEmail}, 收件人=${emailConfig.recipientEmail}`);
      
      // 从邮件配置中获取筛选条件，如果没有则使用默认值
      const scanConfig = emailConfig.filters || this.config.scanConfig || {
        requireUptrend: true,
        maxBSignalAgeDays: 5,
        minExpectedReturn: 35,
        maxChannelPosition: 0.15,
        maxResults: 10,
        enableAdaptiveRelaxation: true,
      };
      
      console.log(`筛选条件:`, scanConfig);

      // 1. 执行扫描
      console.log("步骤1: 执行股票扫描...");
      const scanResult = await runEveningScan(scanConfig);
      console.log(`扫描完成: 共扫描 ${scanResult.totalScanned} 只股票，筛选出 ${scanResult.filteredCount} 只`);
      
      if (scanResult.usedRelaxedCriteria) {
        console.log(`使用了放宽条件:`, scanResult.relaxedCriteria);
      }

      // 2. 生成邮件内容
      console.log("步骤2: 生成邮件内容...");
      const htmlContent = generateEmailHtml(scanResult);
      const textContent = generateEmailText(scanResult);

      // 3. 发送邮件
      console.log("步骤3: 发送邮件...");
      const mailConfig: AgentlyMailConfig = {
        to: emailConfig.recipientEmail,
        subject: `📈 Serenity 晚间精选股票池 - ${scanResult.date}`,
        html: htmlContent,
        text: textContent,
      };

      const mailResult = await sendAgentlyMail(mailConfig);

      if (mailResult.success) {
        console.log("邮件发送成功!");
      } else {
        console.error("邮件发送失败:", mailResult.error);
      }

      console.log("晚间扫描任务完成");
    } catch (error) {
      console.error("晚间扫描执行出错:", error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 获取任务状态
   */
  getStatus(): { running: boolean; scheduled: boolean } {
    return {
      running: this.isRunning,
      scheduled: this.task !== null,
    };
  }
}

/**
 * 创建并启动晚间扫描调度器
 */
export function createEveningScanScheduler(config: SchedulerConfig = {}): EveningScanScheduler {
  const scheduler = new EveningScanScheduler(config);
  scheduler.start();
  return scheduler;
}

/**
 * 创建调度器但不自动启动（用于手动控制）
 */
export function createEveningScanSchedulerManual(config: SchedulerConfig = {}): EveningScanScheduler {
  return new EveningScanScheduler(config);
}