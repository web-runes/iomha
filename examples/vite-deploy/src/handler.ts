import { getImage } from "astro:assets";
import { endpoint } from "@iomha/temp/v1";
import type { ExportedHandler } from "@vite-deploy/netlify";
import x from "./test.svg";

console.log({ x });

const res = await getImage({ src: x, format: "webp" });
console.log(res.src);

export default {
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/_image")) {
			return endpoint(request, { dangerouslyProcessSVG: true });
		}
		return new Response(`Running ${url.pathname} in ${navigator.userAgent}!`, {
			headers: {
				"content-type": "text/html",
			},
		});
	},
} satisfies ExportedHandler;
