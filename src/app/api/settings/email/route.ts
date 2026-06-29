import { NextRequest, NextResponse } from "next/server";
import { saveEmailConfig, getPublicEmailConfig } from "@/lib/config";
import type { EmailConfig, EveningScanFilters } from "@/lib/types";
import { DEFAULT_EVENING_SCAN_FILTERS } from "@/lib/types";

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
    const { senderEmail, recipientEmail, filters } = body as EmailConfig;
    
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
    
    // Validate filters if provided
    let validatedFilters: EveningScanFilters;
    if (filters) {
      if (typeof filters.requireUptrend !== "boolean" ||
          typeof filters.maxBSignalAgeDays !== "number" ||
          typeof filters.minExpectedReturn !== "number" ||
          typeof filters.maxChannelPosition !== "number" ||
          typeof filters.maxResults !== "number" ||
          typeof filters.enableAdaptiveRelaxation !== "boolean") {
        return NextResponse.json(
          { ok: false, error: "Invalid filters format" },
          { status: 400 }
        );
      }
      
      // Validate filter ranges
      if (filters.maxBSignalAgeDays < 1 || filters.maxBSignalAgeDays > 30) {
        return NextResponse.json(
          { ok: false, error: "maxBSignalAgeDays must be between 1 and 30" },
          { status: 400 }
        );
      }
      if (filters.minExpectedReturn < 0 || filters.minExpectedReturn > 100) {
        return NextResponse.json(
          { ok: false, error: "minExpectedReturn must be between 0 and 100" },
          { status: 400 }
        );
      }
      if (filters.maxChannelPosition < 0 || filters.maxChannelPosition > 1) {
        return NextResponse.json(
          { ok: false, error: "maxChannelPosition must be between 0 and 1" },
          { status: 400 }
        );
      }
      if (filters.maxResults < 1 || filters.maxResults > 50) {
        return NextResponse.json(
          { ok: false, error: "maxResults must be between 1 and 50" },
          { status: 400 }
        );
      }
      
      validatedFilters = filters;
    } else {
      validatedFilters = { ...DEFAULT_EVENING_SCAN_FILTERS };
    }
    
    const config: EmailConfig = {
      senderEmail: senderEmail?.trim() || "",
      recipientEmail: recipientEmail?.trim() || "",
      filters: validatedFilters,
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