import { createIomha } from "@iomha/core";
import { createReactHelpers } from "@iomha/react-adapter";
import { sharpProvider } from "@iomha/sharp-provider";
import { sharpMiddleware } from "@iomha/sharp-provider/hono";
import { unpicProvider } from "@iomha/unpic-provider";

app.use(sharpMiddleware("/assets/_image"));

const iomha = createIomha({
	providers: {
		sharp: sharpProvider({
			route: "/assets/_image",
		}),
		unpic: unpicProvider(),
	},
});

export const { Image, Picture } = createReactHelpers(iomha);

export const { getImage } = iomha;

export default iomha;

import { iomhaPlugin } from "@iomha/vite";
import { defineConfig } from "vite";

defineConfig({
	plugins: [
		iomhaPlugin({
			entrypoint: "./src/iomha.ts",
		}),
	],
});

import img from "./test.png" with {
	format: "webp",
	height: "200",
	width: "500",
};

// { src: "/_image/xxx.hash.xxx" }

const image = iomha.getImage({});

function* getStaticPaths() {
	yield ["/", "/about"];
	yield iomha.getStaticPaths();
}
