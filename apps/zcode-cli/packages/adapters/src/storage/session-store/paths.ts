import { homedir } from "node:os";
import { join } from "node:path";

export function getDefaultSessionDbPath(): string {
  return join(homedir(), ".wcode", "cli", "db", "db.sqlite");
}
