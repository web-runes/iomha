import * as os from "node:os";
import MagicString from "magic-string";
import PQueue from "p-queue";
import type * as vite from "vite";
import {
	generateImagesForPath,
	getStaticImageList,
	getTimeStat,
	prepareAssetsGenerationEnv,
} from "./build/generate.js";
import {
	ASTRO_VITE_ENVIRONMENT_NAMES,
	RESOLVED_VIRTUAL_GET_IMAGE_ID,
	RESOLVED_VIRTUAL_IMAGE_STYLES_ID,
	RESOLVED_VIRTUAL_MODULE_ID,
	VALID_INPUT_FORMATS,
	VIRTUAL_GET_IMAGE_ID,
	VIRTUAL_IMAGE_STYLES_ID,
	VIRTUAL_MODULE_ID,
	VIRTUAL_SERVICE_ID,
} from "./consts.js";
import {
	appendForwardSlash,
	joinPaths,
	prependForwardSlash,
	removeBase,
	removeQueryString,
} from "./internal-helpers/path.js";
import type { ImageTransform, ResolvedImageConfig } from "./types.js";
import { emitClientAsset } from "./utils/assets.js";
import { hashTransform, propsToFilename } from "./utils/hash.js";
import { isESMImportedImage } from "./utils/imageKind.js";
import { emitImageMetadata } from "./utils/node.js";
import { getProxyCode } from "./utils/proxy.js";
import { createPlaceholderURL, stringifyPlaceholderURL } from "./utils/url.js";
import { normalizePath } from "./utils/viteUtils.js";

function isAstroServerEnvironment(environment: vite.Environment) {
	return (
		environment.name === ASTRO_VITE_ENVIRONMENT_NAMES.ssr ||
		environment.name === ASTRO_VITE_ENVIRONMENT_NAMES.prerender ||
		environment.name === ASTRO_VITE_ENVIRONMENT_NAMES.astro
	);
}

const assetRegex = new RegExp(`\\.(${VALID_INPUT_FORMATS.join("|")})`, "i");
const assetRegexEnds = new RegExp(
	`\\.(${VALID_INPUT_FORMATS.join("|")})$`,
	"i",
);
const addStaticImageFactory = (settings: {
	base: vite.ResolvedConfig["base"];
	image: ResolvedImageConfig;
	assets: vite.ResolvedConfig["build"]["assetsDir"];
}): typeof globalThis.astroAsset.addStaticImage => {
	return (options, hashProperties, originalFSPath) => {
		if (!globalThis.astroAsset.staticImages) {
			globalThis.astroAsset.staticImages = new Map<
				string,
				{
					originalSrcPath: string;
					transforms: Map<
						string,
						{ finalPath: string; transform: ImageTransform }
					>;
				}
			>();
		}

		// Rollup will copy the file to the output directory, as such this is the path in the output directory, including the asset prefix / base
		const ESMImportedImageSrc = isESMImportedImage(options.src)
			? options.src.src
			: options.src;
		const assetPrefix = "";

		// This is the path to the original image, from the dist root, without the base or the asset prefix (e.g. /_astro/image.hash.png)
		const finalOriginalPath = removeBase(
			removeBase(ESMImportedImageSrc, settings.base),
			assetPrefix,
		);

		const hash = hashTransform(
			options,
			settings.image.service.entrypoint,
			hashProperties,
		);

		let finalFilePath: string;
		let transformsForPath =
			globalThis.astroAsset.staticImages.get(finalOriginalPath);
		const transformForHash = transformsForPath?.transforms.get(hash);

		// If the same image has already been transformed with the same options, we'll reuse the final path
		if (transformsForPath && transformForHash) {
			finalFilePath = transformForHash.finalPath;
		} else {
			finalFilePath = prependForwardSlash(
				joinPaths(
					isESMImportedImage(options.src) ? "" : settings.assets,
					prependForwardSlash(
						propsToFilename(finalOriginalPath, options, hash),
					),
				),
			);

			if (!transformsForPath) {
				transformsForPath = {
					originalSrcPath: originalFSPath,
					transforms: new Map(),
				};
				globalThis.astroAsset.staticImages.set(
					finalOriginalPath,
					transformsForPath,
				);
			}

			transformsForPath.transforms.set(hash, {
				finalPath: finalFilePath,
				transform: options,
			});
		}

		// The paths here are used for URLs, so we need to make sure they have the proper format for an URL
		// (leading slash, prefixed with the base / assets prefix, encoded, etc)
		// Create URL object to safely manipulate and append assetQueryParams if available (for adapter-level tracking like skew protection)
		const url = createPlaceholderURL(
			encodeURI(prependForwardSlash(joinPaths(settings.base, finalFilePath))),
		);

		return stringifyPlaceholderURL(url);
	};
};

interface Options {
	image: ResolvedImageConfig;
}

export function vitePlugin({ image }: Options): vite.Plugin[] {
	let resolvedConfig: vite.ResolvedConfig;
	let shouldEmitFile = false;
	let isBuild = false;

	globalThis.astroAsset = {
		referencedImages: new Set(),
	};

	let built = false;

	return [
		// Expose the components and different utilities from `astro:assets`
		{
			name: "astro:assets",
			config(_, env) {
				isBuild = env.command === "build";
			},
			resolveId: {
				filter: {
					id: new RegExp(
						`^(${VIRTUAL_SERVICE_ID}|${VIRTUAL_MODULE_ID}|${VIRTUAL_GET_IMAGE_ID})$`,
					),
				},
				async handler(id) {
					if (id === VIRTUAL_SERVICE_ID) {
						if (isAstroServerEnvironment(this.environment)) {
							return await this.resolve(image.service.entrypoint);
						}
						return await this.resolve(
							new URL("./services/noop.js", import.meta.url).href,
						);
					}
					if (id === VIRTUAL_MODULE_ID) {
						return RESOLVED_VIRTUAL_MODULE_ID;
					}
					if (id === VIRTUAL_GET_IMAGE_ID) {
						return RESOLVED_VIRTUAL_GET_IMAGE_ID;
					}
				},
			},
			load: {
				filter: {
					id: new RegExp(
						`^(${RESOLVED_VIRTUAL_MODULE_ID}|${RESOLVED_VIRTUAL_GET_IMAGE_ID})$`,
					),
				},
				handler(id) {
					if (id === RESOLVED_VIRTUAL_GET_IMAGE_ID) {
						// Lightweight module exporting only getImage + imageConfig.
						// No component references (Image, Picture, Font) to avoid TDZ
						// errors when the content runtime and component pages are
						// bundled into the same prerender chunk (see #16036).
						const isServerEnvironment = isAstroServerEnvironment(
							this.environment,
						);
						const getImageExport = isServerEnvironment
							? `import { getImage as getImageInternal } from ${JSON.stringify(new URL("./internal.js", import.meta.url))};
								export const getImage = async (options) => await getImageInternal(options, imageConfig);`
							: `
								export const getImage = async () => {
									throw new Error("getImage() must be used on the server.")
								};`;
						return {
							code: `
								export const imageConfig = ${JSON.stringify(image)};
								${getImageExport}
							`,
						};
					}
					const isServerEnvironment = isAstroServerEnvironment(
						this.environment,
					);
					const getImageExport = isServerEnvironment
						? `import { getImage as getImageInternal } from ${JSON.stringify(new URL("./internal.js", import.meta.url))};
							export const getImage = async (options) => await getImageInternal(options, imageConfig);`
						: `
							export const getImage = async () => {
								throw new Error("getImage() must be used on the server.")
							};`;

					return {
						code: `
				import { getConfiguredImageService as _getConfiguredImageService } from ${JSON.stringify(new URL("./internal.js", import.meta.url))};
				export { isLocalService } from ${JSON.stringify(new URL("./internal.js", import.meta.url))};
				${image.responsiveStyles ? `import "${VIRTUAL_IMAGE_STYLES_ID}";` : ""}

					export const getConfiguredImageService = _getConfiguredImageService;

					export const viteFSConfig = ${JSON.stringify(resolvedConfig.server.fs ?? {})};

					export const safeModulePaths = new Set(${JSON.stringify(
						// @ts-expect-error safeModulePaths is internal to Vite
						Array.from(resolvedConfig.safeModulePaths ?? []),
					)});

					export const imageConfig = ${JSON.stringify(image)};
					${getImageExport}
				`,
					};
				},
			},
			buildStart() {
				if (!isBuild) return;
				globalThis.astroAsset.addStaticImage = addStaticImageFactory({
					image,
					assets: this.environment.config.build.assetsDir,
					base: this.environment.config.base,
				});
			},

			// Source: https://github.com/withastro/astro/blob/9446049b0d8f3245f24ddfe6eb84472481962564/packages/astro/src/core/build/generate.ts
			async buildEnd() {
				if (built) return;
				const staticImageList = getStaticImageList();

				if (staticImageList.size) {
					// Default pipeline always runs
					this.environment.logger.info("generating optimized images");

					const totalCount = Array.from(staticImageList.values())
						.map((x) => x.transforms.size)
						.reduce((a, b) => a + b, 0);
					const cpuCount = os.cpus().length;
					const serverEnv = this.environment.config.environments.ssr;
					const clientEnv = this.environment.config.environments.client;
					const assetsCreationPipeline = await prepareAssetsGenerationEnv(
						{
							assets: clientEnv.build.assetsDir,
							cacheDir: this.environment.config.cacheDir,
							root: this.environment.config.root,
							clientOutDir: clientEnv.build.outDir,
							serverOutDir: serverEnv.build.outDir,
							image,
							logger: this.environment.logger,
						},
						totalCount,
					);
					const queue = new PQueue({ concurrency: Math.max(cpuCount, 1) });

					const assetsTimer = performance.now();
					for (const [originalPath, transforms] of staticImageList) {
						// Process each source image in parallel based on the queue’s concurrency
						// (`cpuCount`). Process each transform for a source image sequentially.
						//
						// # Design Decision:
						// We have 3 source images (A.png, B.png, C.png) and 3 transforms for
						// each:
						// ```
						// A1.png A2.png A3.png
						// B1.png B2.png B3.png
						// C1.png C2.png C3.png
						// ```
						//
						// ## Option 1
						// Enqueue all transforms indiscriminantly
						// ```
						// |_A1.png   |_B2.png   |_C1.png
						// |_B3.png   |_A2.png   |_C3.png
						// |_C2.png   |_A3.png   |_B1.png
						// ```
						// * Advantage: Maximum parallelism, saturate CPU
						// * Disadvantage: Spike in context switching
						//
						// ## Option 2
						// Enqueue all transforms, but constrain processing order by source image
						// ```
						// |_A3.png   |_B1.png   |_C2.png
						// |_A1.png   |_B3.png   |_C1.png
						// |_A2.png   |_B2.png   |_C3.png
						// ```
						// * Advantage: Maximum parallelism, saturate CPU (same as Option 1) in
						//   hope to avoid context switching
						// * Disadvantage: Context switching still occurs and performance still
						//   suffers
						//
						// ## Option 3
						// Enqueue each source image, but perform the transforms for that source
						// image sequentially
						// ```
						// \_A1.png   \_B1.png   \_C1.png
						//  \_A2.png   \_B2.png   \_C2.png
						//   \_A3.png   \_B3.png   \_C3.png
						// ```
						// * Advantage: Less context switching
						// * Disadvantage: If you have a low number of source images with high
						//   number of transforms then this is suboptimal.
						//
						// ## BEST OPTION:
						// **Option 3**. Most projects will have a higher number of source images
						// with a few transforms on each. Even though Option 2 should be faster
						// and _should_ prevent context switching, this was not observed in
						// nascent tests. Context switching was high and the overall performance
						// was half of Option 3.
						//
						// If looking to optimize further, please consider the following:
						// * Avoid `queue.add()` in an async for loop. Notice the `await
						//   queue.onIdle();` after this loop. We do not want to create a scenario
						//   where tasks are added to the queue after the queue.onIdle() resolves.
						//   This can break tests and create annoying race conditions.
						// * Exposing a concurrency property in `astro.config.mjs` to allow users
						//   to override Node’s os.cpus().length default.
						// * Create a proper performance benchmark for asset transformations of
						//   projects in varying sizes of source images and transforms.
						queue
							.add(() =>
								generateImagesForPath(
									originalPath,
									transforms,
									assetsCreationPipeline,
								),
							)
							.catch((e) => {
								throw e;
							});
					}

					await queue.onIdle();
					const assetsTimeEnd = performance.now();
					this.environment.logger.info(
						`✓ Completed in ${getTimeStat(assetsTimer, assetsTimeEnd)}.\n`,
					);

					delete globalThis?.astroAsset?.addStaticImage;
				}
				built = true;
			},
			// In build, rewrite paths to ESM imported images in code to their final location
			async renderChunk(code) {
				const assetUrlRE = /__ASTRO_ASSET_IMAGE__([\w$]+)__(?:_(.*?)__)?/g;

				let match: RegExpExecArray | null;
				let s: MagicString | undefined;
				// biome-ignore lint/suspicious/noAssignInExpressions: it's fine
				while ((match = assetUrlRE.exec(code))) {
					// biome-ignore lint/suspicious/noAssignInExpressions: it's fine
					s = s || (s = new MagicString(code));
					const [full, hash, postfix = ""] = match;

					const file = this.getFileName(hash);
					const pf = "";
					const prefix = pf ? appendForwardSlash(pf) : resolvedConfig.base;
					const outputFilepath = prefix + normalizePath(file + postfix);

					s.overwrite(match.index, match.index + full.length, outputFilepath);
				}

				if (s) {
					return {
						code: s.toString(),
						map: resolvedConfig.build.sourcemap
							? s.generateMap({ hires: "boundary" })
							: null,
					};
				} else {
					return null;
				}
			},
		},
		// Return a more advanced shape for images imported in ESM
		{
			name: "astro:assets:esm",
			enforce: "pre",
			config(_, env) {
				shouldEmitFile = env.command === "build";
			},
			configResolved(viteConfig) {
				resolvedConfig = viteConfig;
			},
			load: {
				filter: {
					id: assetRegex,
				},
				async handler(id) {
					if (!globalThis.astroAsset.referencedImages)
						globalThis.astroAsset.referencedImages = new Set();

					if (id !== removeQueryString(id)) {
						// If our import has any query params, we'll let Vite handle it, nonetheless we'll make sure to not delete it
						// See https://github.com/withastro/astro/issues/8333
						globalThis.astroAsset.referencedImages.add(removeQueryString(id));
						return;
					}

					// If the requested ID doesn't end with a valid image extension, we'll let Vite handle it
					if (!assetRegexEnds.test(id)) {
						return;
					}

					const fileEmitter = shouldEmitFile
						? (opts: Parameters<typeof this.emitFile>[0]) =>
								emitClientAsset(this as any, opts)
						: undefined;
					const imageMetadata = await emitImageMetadata(id, fileEmitter);

					if (!imageMetadata) {
						throw new Error("Image not found.");
					}

					// We can only reliably determine if an image is used on the server, as we need to track its usage throughout the entire build.
					// Since you cannot use image optimization on the client anyway, it's safe to assume that if the user imported
					// an image on the client, it should be present in the final build.
					if (isAstroServerEnvironment(this.environment)) {
						// In SSR builds, any image loaded by the SSR environment could be reachable at
						// request time without us knowing, so we'll always consider them as referenced.
						const isSSROnlyEnvironment =
							this.environment.name === ASTRO_VITE_ENVIRONMENT_NAMES.ssr;
						if (isSSROnlyEnvironment) {
							globalThis.astroAsset.referencedImages.add(imageMetadata.fsPath);
						}
						return {
							code: `export default ${getProxyCode(imageMetadata, isSSROnlyEnvironment)}`,
						};
					} else {
						globalThis.astroAsset.referencedImages.add(imageMetadata.fsPath);
						return {
							code: `export default ${JSON.stringify(imageMetadata)}`,
						};
					}
				},
			},
		},
		{
			name: "astro:image-styles",
			resolveId: {
				filter: {
					id: new RegExp(`^${VIRTUAL_IMAGE_STYLES_ID}$`),
				},
				handler(id) {
					if (id === VIRTUAL_IMAGE_STYLES_ID) {
						return RESOLVED_VIRTUAL_IMAGE_STYLES_ID;
					}
				},
			},
			load: {
				filter: {
					id: new RegExp(`^${RESOLVED_VIRTUAL_IMAGE_STYLES_ID}$`),
				},
				async handler(id) {
					if (id === RESOLVED_VIRTUAL_IMAGE_STYLES_ID) {
						const { generateImageStylesCSS } = await import(
							"./utils/generateImageStylesCSS.js"
						);
						const css = generateImageStylesCSS(
							image.objectFit,
							image.objectPosition,
						);
						return { code: css };
					}
				},
			},
		},
	];
}
