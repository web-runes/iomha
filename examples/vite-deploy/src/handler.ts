import { endpoint } from "@iomha/temp";
import type { ExportedHandler } from "@vite-deploy/netlify";

export default {
	fetch(request) {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/_image")) {
			return endpoint(request, { dangerouslyProcessSVG: true });
		}
		return new Response(`Running ${url.pathname} in ${navigator.userAgent}!`);
	},
} satisfies ExportedHandler;
