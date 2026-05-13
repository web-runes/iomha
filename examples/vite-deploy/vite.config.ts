// import { iomhaPlugin } from "@iomha/temp/v1";
import { vitePlugin } from "@iomha/temp/v2";
import netlify from "@vite-deploy/netlify";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		netlify({
			output: "hybrid",
			prerender: {
				entrypoint: "./src/prerender.ts",
			},
			handlerEntrypoint: "./src/handler.ts",
		}),
		vitePlugin({
			image: {
				dangerouslyProcessSVG: true,
				domains: [],
				endpoint: {
					route: "/_image",
				},
				remotePatterns: [],
				responsiveStyles: false,
				service: {
					config: {},
					entrypoint: "./node_modules/@iomha/temp/dist/v2/services/sharp.js",
				},
			},
		}),
		// iomhaPlugin(),
	],
});
