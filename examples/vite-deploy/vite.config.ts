import netlify from "@vite-deploy/netlify";
import { defineConfig } from "vite";
import { iomhaPlugin } from "@iomha/temp/v1";

export default defineConfig({
	plugins: [
		netlify({
			output: "hybrid",
			prerender: {
				entrypoint: "./src/prerender.ts",
			},
			handlerEntrypoint: "./src/handler.ts",
		}),
		iomhaPlugin(),
	],
});
