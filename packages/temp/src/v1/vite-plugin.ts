import type { AddressInfo } from "node:net";
import type { Plugin } from "vite";
import { removeQueryString } from "./endpoint/path.js";

// TODO: proper ts types for consumers
const VALID_INPUT_FORMATS = [
	"jpeg",
	"jpg",
	"png",
	"tiff",
	"webp",
	"gif",
	"svg",
	"avif",
] as const;

const assetRegex = new RegExp(`\\.(${VALID_INPUT_FORMATS.join("|")})`, "i");
const assetRegexEnds = new RegExp(
	`\\.(${VALID_INPUT_FORMATS.join("|")})$`,
	"i",
);

function formatAddress(
	address: string | AddressInfo | null | undefined,
): string {
	if (!address) return "";
	if (typeof address === "string") return address;
	const host =
		address.family === "IPv6" ? `[${address.address}]` : address.address;
	return `http://${host}:${address.port}`;
}

export function iomhaPlugin(): Plugin {
	let address: string = "";
	return {
		name: "iomha",
		enforce: "pre",
		configureServer(server) {
			server.httpServer?.on("listening", () => {
				address = formatAddress(server.httpServer?.address());
			});
		},
		configurePreviewServer(server) {
			server.httpServer?.on("listening", () => {
				address = formatAddress(server.httpServer?.address());
			});
		},
		load: {
			filter: {
				id: assetRegex,
			},
			handler(id) {
				// If our import has any query params, we'll let Vite handle it
				if (id !== removeQueryString(id)) {
					return;
				}

				// If the requested ID doesn't end with a valid image extension, we'll let Vite handle it
				if (!assetRegexEnds.test(id)) {
					return;
				}

				return {
					code: `
function getImageMetadata(src) {
    // TODO: find a way to get rest of metadata without fetching to avoid circular dependency
    return {
        src,
    }
}
export default getImageMetadata(${JSON.stringify(`${this.environment.name === "ssr" ? address : ""}/_image?href=/@fs${id}`)})
`,
					moduleType: "js",
				};
			},
		},
	};
}
