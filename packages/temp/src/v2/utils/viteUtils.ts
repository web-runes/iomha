import path from "node:path";
import { slash } from "../internal-helpers/path.js";

const isWindows =
	typeof process !== "undefined" && process.platform === "win32";

/**
 * Re-implementation of Vite's normalizePath that can be used without Vite
 */
export function normalizePath(id: string): string {
	return path.posix.normalize(isWindows ? slash(id) : id);
}
