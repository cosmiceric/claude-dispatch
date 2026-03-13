import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export function isDispatchEnabled(): boolean {
  try {
    const content = readFileSync(join(homedir(), ".dispatch-enabled"), "utf-8").trim();
    return content === "true";
  } catch {
    return false;
  }
}
