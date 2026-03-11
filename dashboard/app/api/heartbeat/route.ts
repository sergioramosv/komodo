import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    const rootDir = process.env.KOMODO_ROOT || path.resolve("..", ".."); 
    // Usually nextjs is in komodo/dashboard, so komodo root is ".."
    // We'll try a few paths to be safe.
    
    const possiblePaths = [
      path.resolve(process.cwd(), "..", "heartbeat.json"),
      path.resolve(process.cwd(), "..", "..", "heartbeat.json"),
      path.resolve(process.cwd(), "heartbeat.json")
    ];

    let fileContent = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        fileContent = fs.readFileSync(p, "utf8");
        break;
      }
    }

    if (!fileContent) {
      return NextResponse.json({ error: "No heartbeat.json found" }, { status: 404 });
    }

    const data = JSON.parse(fileContent);

    // Calculate dynamic time remaining based on current time
    const now = Date.now();
    
    if (data.cliHealth) {
      data.globalCooldownMinutes = null;

      for (const cli of Object.keys(data.cliHealth)) {
        const health = data.cliHealth[cli];
        if (health.status === "rate-limited" && health.rateLimitedAt && health.cooldownMinutes) {
          const rateLimitedAtMs = new Date(health.rateLimitedAt).getTime();
          const elapsed = (now - rateLimitedAtMs) / 60000;
          const remaining = Math.ceil(health.cooldownMinutes - elapsed);
          
          if (remaining > 0) {
             if (data.globalCooldownMinutes === null || remaining < data.globalCooldownMinutes) {
                data.globalCooldownMinutes = remaining;
             }
             health.dynamicRemainingMinutes = remaining;
          } else {
             health.dynamicRemainingMinutes = 0;
          }
        }
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
