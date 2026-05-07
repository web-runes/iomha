/**
 * Checks whether the path is considered a remote path.
 * Remote means untrusted in this context, so anything that isn't a straightforward
 * local path is considered remote.
 *
 * @param src
 */
export function isRemotePath(src: string): boolean {
	if (!src) return false;

	// Trim leading/trailing whitespace
	const trimmed = src.trim();
	if (!trimmed) return false;

	// Recursively decode URL-encoded characters to catch multi-level obfuscation
	let decoded = trimmed;
	let previousDecoded = "";
	let maxIterations = 10; // Prevent infinite loops on malformed input

	while (decoded !== previousDecoded && maxIterations > 0) {
		previousDecoded = decoded;
		try {
			decoded = decodeURIComponent(decoded);
		} catch {
			// If decoding fails (e.g., invalid %), stop and use what we have
			break;
		}
		maxIterations--;
	}

	// Check for Windows paths first (C:\, D:\, C:file, etc.)
	// This needs to be before the backslash check
	if (/^[a-zA-Z]:/.test(decoded)) {
		// Windows path with drive letter - always local
		return false;
	}

	// Check for Unix absolute path (starts with / but not // or /\)
	// This needs to be before the backslash check
	if (decoded[0] === "/" && decoded[1] !== "/" && decoded[1] !== "\\") {
		return false;
	}

	// Any backslash at the start is probably trouble. Treat as remote.
	if (decoded[0] === "\\") {
		return true;
	}

	// Protocol-relative URLs are remote
	if (decoded.startsWith("//")) {
		return true;
	}

	// Try to parse as URL to check for protocols and credentials
	try {
		// Try with a mock base URL for relative URLs that might have protocols
		const url = new URL(decoded, "http://n");
		// Check for credentials first - ANY URL with credentials is suspicious
		if (url.username || url.password) {
			return true;
		}

		if (
			decoded.includes("@") &&
			!url.pathname.includes("@") &&
			!url.search.includes("@")
		) {
			// If the original string had an @ but it wasn't in the pathname or search,
			// it must have been in the authority section (credentials or domain).
			// Since we already checked for credentials, this is something dodgy.
			return true;
		}
		// If the input had its own protocol, it would override the base
		if (url.origin !== "http://n") {
			// It had its own protocol - check what it is
			const protocol = url.protocol.toLowerCase();

			// Only file: protocol without credentials is considered local
			if (protocol === "file:") {
				return false;
			}
			// All other protocols are remote (http:, https:, ftp:, ws:, data:, etc.)
			return true;
		}
		// If we can parse it both with and without a base URL, it's probably remote
		if (URL.canParse(decoded)) {
			return true;
		}
		return false;
	} catch {
		return true;
	}
}
