import { endpoint } from "@iomha/temp/v1";
import type { ExportedHandler } from "@vite-deploy/netlify";
import x from "./test.svg";

console.log({ x });

export default {
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/_image")) {
			return endpoint(request, { dangerouslyProcessSVG: true });
		}
		return new Response(`Running ${url.pathname} in ${navigator.userAgent}!`);
	},
} satisfies ExportedHandler;
