import { createIomha } from "@iomha/core";
import { sharpProvider } from "@iomha/sharp-provider";
import { sharpMiddleware } from "@iomha/sharp-provider/hono";
import { unpicProvider } from "@iomha/unpic-provider";
import { createReactHelpers } from "@iomha/react-adapter";

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

export const { getImage } = iomha

export default iomha;

import { defineConfig } from "vite";
import { iomhaPlugin } from "@iomha/vite";

defineConfig({
  plugins: [
    iomhaPlugin({
      entrypoint: "./src/iomha.ts",
    }),
  ],
});

import img from "./test.png" with {
  width: "500",
  height: "200",
  format: "webp",
};
// { src: "/_image/xxx.hash.xxx" }

const image = iomha.getImage({});

function* getStaticPaths() {
  yield ["/", "/about"];
  yield iomha.getStaticPaths();
}
