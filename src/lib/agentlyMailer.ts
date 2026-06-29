import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface AgentlyMailConfig {
  /** 收件人邮箱 */
  to: string;
  /** 邮件主题 */
  subject: string;
  /** 邮件HTML内容 */
  html: string;
  /** 邮件纯文本内容（可选） */
  text?: string;
}

/**
 * 使用 agently-cli 发送邮件（支持两步确认）
 * 
 * agently-cli 的邮件发送需要两步确认：
 * 1. 第一次调用返回 confirmation_token
 * 2. 第二次调用使用 --confirmation-token 完成发送
 * 
 * 注意：需要先通过 `agently-cli auth login` 完成授权
 */
export async function sendAgentlyMail(config: AgentlyMailConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const fs = await import("fs/promises");
    const os = await import("os");
    const path = await import("path");
    
    // 创建临时目录
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agently-mail-"));
    
    // 将HTML内容写入临时文件（支持富文本格式）
    const bodyFile = path.join(tempDir, "body.html");
    await fs.writeFile(bodyFile, config.html, "utf8");

    // 第一步：发送邮件请求，获取 confirmation_token
    const firstCommand = `agently-cli message +send --to "${config.to}" --subject "${config.subject}" --body-file ./body.html`;
    
    console.log("执行第一步邮件发送...");
    const { stdout: firstStdout, stderr: firstStderr } = await execAsync(firstCommand, {
      timeout: 30000,
      cwd: tempDir,
    });

    console.log("第一步响应:", firstStdout);

    // 解析响应，获取 confirmation_token
    let confirmToken: string | null = null;
    try {
      const response = JSON.parse(firstStdout);
      if (response.data && response.data.confirmation_token) {
        confirmToken = response.data.confirmation_token;
      } else if (response.confirmation_required && response.confirmation_token) {
        confirmToken = response.confirmation_token;
      }
    } catch (e) {
      // 如果JSON解析失败，尝试从文本中提取token
      const tokenMatch = firstStdout.match(/confirmation_token["\s:]+([^\s"}]+)/);
      if (tokenMatch) {
        confirmToken = tokenMatch[1];
      }
    }

    if (!confirmToken) {
      // 清理临时文件
      await fs.rm(tempDir, { recursive: true, force: true });
      return { 
        success: false, 
        error: `无法获取确认令牌。响应: ${firstStdout}` 
      };
    }

    console.log("获取到确认令牌:", confirmToken);

    // 第二步：使用 confirmation_token 完成发送
    const secondCommand = `agently-cli message +send --to "${config.to}" --subject "${config.subject}" --body-file ./body.html --confirmation-token "${confirmToken}"`;
    
    console.log("执行第二步邮件发送...");
    const { stdout: secondStdout, stderr: secondStderr } = await execAsync(secondCommand, {
      timeout: 30000,
      cwd: tempDir,
    });

    console.log("第二步响应:", secondStdout);

    // 清理临时文件
    await fs.rm(tempDir, { recursive: true, force: true });

    // 检查是否成功
    if (secondStderr && secondStderr.includes("error")) {
      return { success: false, error: secondStderr };
    }

    return { success: true };
  } catch (error) {
    console.error("发送邮件失败:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * 简化版本：直接发送纯文本邮件（跳过HTML）
 */
export async function sendAgentlyMailSimple(config: AgentlyMailConfig): Promise<{ success: boolean; error?: string }> {
  try {
    // 使用纯文本内容
    const body = config.text || config.html.replace(/<[^>]*>/g, '');
    
    // 第一步：获取确认令牌
    const firstCommand = `agently-cli message +send --to "${config.to}" --subject "${config.subject}" --body "${body}"`;
    
    console.log("执行第一步邮件发送...");
    const { stdout: firstStdout, stderr: firstStderr } = await execAsync(firstCommand, {
      timeout: 30000,
    });

    console.log("第一步响应:", firstStdout);

    // 解析确认令牌
    let confirmToken: string | null = null;
    try {
      const response = JSON.parse(firstStdout);
      if (response.data && response.data.confirmation_token) {
        confirmToken = response.data.confirmation_token;
      } else if (response.confirmation_required && response.confirmation_token) {
        confirmToken = response.confirmation_token;
      }
    } catch (e) {
      const tokenMatch = firstStdout.match(/confirmation_token["\s:]+([^\s"}]+)/);
      if (tokenMatch) {
        confirmToken = tokenMatch[1];
      }
    }

    if (!confirmToken) {
      return { 
        success: false, 
        error: `无法获取确认令牌。响应: ${firstStdout}` 
      };
    }

    // 第二步：完成发送
    const secondCommand = `agently-cli message +send --to "${config.to}" --subject "${config.subject}" --body "${body}" --confirmation-token "${confirmToken}"`;
    
    console.log("执行第二步邮件发送...");
    const { stdout: secondStdout, stderr: secondStderr } = await execAsync(secondCommand, {
      timeout: 30000,
    });

    console.log("第二步响应:", secondStdout);

    if (secondStderr && secondStderr.includes("error")) {
      return { success: false, error: secondStderr };
    }

    return { success: true };
  } catch (error) {
    console.error("发送邮件失败:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}
