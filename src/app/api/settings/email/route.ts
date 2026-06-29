import { NextRequest, NextResponse } from "next/server";
import { loadEmailConfig, saveEmailConfig, getPublicEmailConfig } from "@/lib/config";
import type { EmailConfig } from "@/lib/types";

/**
 * GET /api/settings/email - Get public email config (safe for browser)
 */
export async function GET() {
  try {
    const publicConfig = await getPublicEmailConfig();
    return NextResponse.json({ ok: true, config: publicConfig });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load email config" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings/email - Save email config
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { senderEmail, recipientEmail } = body as EmailConfig;
    
    // Basic validation
    if (typeof senderEmail !== "string" || typeof recipientEmail !== "string") {
      return NextResponse.json(
        { ok: false, error: "Invalid email format" },
        { status: 400 }
      );
    }
    
    // Email format validation (basic)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (senderEmail && !emailRegex.test(senderEmail)) {
      return NextResponse.json(
        { ok: false, error: "Invalid sender email format" },
        { status: 400 }
      );
    }
    if (recipientEmail && !emailRegex.test(recipientEmail)) {
      return NextResponse.json(
        { ok: false, error: "Invalid recipient email format" },
        { status: 400 }
      );
    }
    
    const config: EmailConfig = {
      senderEmail: senderEmail?.trim() || "",
      recipientEmail: recipientEmail?.trim() || "",
    };
    
    await saveEmailConfig(config);
    
    // Return public config (without exposing actual emails)
    const publicConfig = await getPublicEmailConfig();
    return NextResponse.json({ ok: true, config: publicConfig });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save email config" },
      { status: 500 }
    );
  }
}