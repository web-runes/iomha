import fs, { readFileSync } from "node:fs";
import { join } from "node:path";
import { basename } from "node:path/posix";
import { styleText } from "node:util";
import type { Logger } from "vite";
import { getConfiguredImageService } from "../internal.js";
import {
	isRemotePath,
	removeLeadingForwardSlash,
} from "../internal-helpers/path.js";
import type { LocalImageService } from "../services/service.js";
import type { MapValue } from "../type-utils.js";
import type {
	AssetsGlobalStaticImagesList,
	ImageMetadata,
	ImageTransform,
	ResolvedImageConfig,
} from "../types.js";
import { isESMImportedImage } from "../utils/imageKind.js";
import {
	loadRemoteImage,
	type RemoteCacheEntry,
	revalidateRemoteImage,
} from "./remote.js";

export function getTimeStat(timeStart: number, timeEnd: number): string {
	const buildTime = timeEnd - timeStart;
	return buildTime < 1000
		? `${Math.round(buildTime)}ms`
		: `${(buildTime / 1000).toFixed(2)}s`;
}

interface GenerationDataUncached {
	cached: "miss";
	weight: {
		before: number;
		after: number;
	};
}

interface GenerationDataCached {
	cached: "revalidated" | "hit";
}

type GenerationData = GenerationDataUncached | GenerationDataCached;

type AssetEnv = {
	logger: Logger;
	count: { total: number; current: number };
	useCache: boolean;
	assetsCacheDir: string;
	serverRoot: string;
	clientRoot: string;
	imageConfig: ResolvedImageConfig;
	assetsFolder: string;
};

type ImageData = {
	data: Uint8Array;
	expires: number;
	etag?: string;
	lastModified?: string;
};

export async function prepareAssetsGenerationEnv(
	{
		logger,
		image,
		assets,
		root,
		cacheDir,
		serverOutDir,
		clientOutDir,
	}: {
		logger: Logger;
		image: ResolvedImageConfig;
		assets: string;
		root: string;
		cacheDir: string;
		serverOutDir: string;
		clientOutDir: string;
	},
	totalCount: number,
): Promise<AssetEnv> {
	let useCache = true;
	const assetsCacheDir = join(root, cacheDir, "assets");
	const count = { total: totalCount, current: 1 };

	// Ensure that the cache directory exists
	try {
		await fs.promises.mkdir(assetsCacheDir, { recursive: true });
	} catch (err) {
		logger.warn(
			`An error was encountered while creating the cache directory. Proceeding without caching. Error: ${err}`,
		);
		useCache = false;
	}

	const serverRoot = join(root, serverOutDir);
	const clientRoot = join(root, clientOutDir);

	return {
		logger,
		count,
		useCache,
		assetsCacheDir,
		serverRoot,
		clientRoot,
		imageConfig: image,
		assetsFolder: assets,
	};
}

function getFullImagePath(originalFilePath: string, env: AssetEnv): string {
	return join(env.serverRoot, removeLeadingForwardSlash(originalFilePath));
}

export async function generateImagesForPath(
	originalFilePath: string,
	transformsAndPath: MapValue<AssetsGlobalStaticImagesList>,
	env: AssetEnv,
): Promise<void> {
	let originalImage: ImageData;

	for (const [_, transform] of transformsAndPath.transforms) {
		await generateImage(transform.finalPath, transform.transform);
	}

	// Delete original images that are only used for optimization
	// The referencedImages set tracks images that were used via raw `src` access (e.g., <img src={img.src}>).
	if (
		transformsAndPath.originalSrcPath &&
		!globalThis.astroAsset.referencedImages?.has(
			transformsAndPath.originalSrcPath,
		)
	) {
		try {
			if (transformsAndPath.originalSrcPath) {
				// console.debug(
				// 	`Deleting ${originalFilePath} as it's not referenced outside of image processing.`,
				// );
				await fs.promises.unlink(getFullImagePath(originalFilePath, env));
			}
		} catch {
			/* No-op, it's okay if we fail to delete one of the file, we're not too picky. */
		}
	}

	async function generateImage(filepath: string, options: ImageTransform) {
		const timeStart = performance.now();
		const generationData = await generateImageInternal(filepath, options);

		const timeEnd = performance.now();
		const timeChange = getTimeStat(timeStart, timeEnd);
		const timeIncrease = `(+${timeChange})`;
		const statsText =
			generationData.cached !== "miss"
				? generationData.cached === "hit"
					? `(reused cache entry)`
					: `(revalidated cache entry)`
				: `(before: ${generationData.weight.before}kB, after: ${generationData.weight.after}kB)`;
		const count = `(${env.count.current}/${env.count.total})`;
		env.logger.info(
			`  ${styleText("green", "▶")} ${filepath} ${styleText("dim", statsText)} ${styleText("dim", timeIncrease)} ${styleText("dim", count)}`,
		);
		env.count.current++;
	}

	async function generateImageInternal(
		filepath: string,
		options: ImageTransform,
	): Promise<GenerationData> {
		const isLocalImage = isESMImportedImage(options.src);
		const finalFileURL = join(env.clientRoot, `.${filepath}`);

		const finalFolderURL = new URL("./", finalFileURL);
		await fs.promises.mkdir(finalFolderURL, { recursive: true });

		const cacheFile = basename(filepath);
		const cachedFileURL = join(env.assetsCacheDir, cacheFile);

		// For remote images, we also save a JSON file with the expiration date, etag and last-modified date from the server
		const cacheMetaFile = `${cacheFile}.json`;
		const cachedMetaFileURL = join(env.assetsCacheDir, cacheMetaFile);

		// Check if we have a cached entry first
		try {
			if (isLocalImage) {
				await fs.promises.copyFile(
					cachedFileURL,
					finalFileURL,
					fs.constants.COPYFILE_FICLONE,
				);

				return {
					cached: "hit",
				};
			} else {
				const JSONData = JSON.parse(
					readFileSync(cachedMetaFileURL, "utf-8"),
				) as RemoteCacheEntry;

				if (typeof JSONData.expires !== "number") {
					await Promise.allSettled([
						fs.promises.unlink(cachedFileURL),
						fs.promises.unlink(cachedMetaFileURL),
					]);

					throw new Error(
						`Malformed cache entry for ${filepath}, cache will be regenerated for this file.`,
					);
				}

				// Upgrade old base64 encoded asset cache to the new format
				if (JSONData.data) {
					const { data, ...meta } = JSONData;

					await Promise.all([
						fs.promises.writeFile(cachedFileURL, Buffer.from(data, "base64")),
						writeCacheMetaFile(cachedMetaFileURL, meta, env),
					]);
				}

				// If the cache entry is not expired, use it
				if (JSONData.expires > Date.now()) {
					await fs.promises.copyFile(
						cachedFileURL,
						finalFileURL,
						fs.constants.COPYFILE_FICLONE,
					);

					return { cached: "hit" };
				}

				// Try to revalidate the cache
				if (JSONData.etag || JSONData.lastModified) {
					try {
						const revalidatedData = await revalidateRemoteImage(
							options.src as string,
							{
								etag: JSONData.etag,
								lastModified: JSONData.lastModified,
							},
						);

						if (revalidatedData.data !== null) {
							// Image cache was stale, update original image to avoid redownload
							originalImage = revalidatedData as ImageData;
						} else {
							// Freshen cache on disk and output cached image
							await Promise.all([
								writeCacheMetaFile(cachedMetaFileURL, revalidatedData, env),
								fs.promises.copyFile(
									cachedFileURL,
									finalFileURL,
									fs.constants.COPYFILE_FICLONE,
								),
							]);

							return { cached: "revalidated" };
						}
					} catch (e) {
						// Reuse stale cache if revalidation fails
						env.logger.warn(
							`An error was encountered while revalidating a cached remote asset. Proceeding with stale cache. ${e}`,
						);

						await fs.promises.copyFile(
							cachedFileURL,
							finalFileURL,
							fs.constants.COPYFILE_FICLONE,
						);
						return { cached: "hit" };
					}
				}

				await Promise.allSettled([
					fs.promises.unlink(cachedFileURL),
					fs.promises.unlink(cachedMetaFileURL),
				]);
			}
		} catch (e: any) {
			if (e.code !== "ENOENT") {
				throw new Error(
					`An error was encountered while reading the cache file. Error: ${e}`,
				);
			}
			// If the cache file doesn't exist, just move on, and we'll generate it
		}

		// The original filepath or URL from the image transform
		const originalImagePath = isLocalImage
			? (options.src as ImageMetadata).src
			: (options.src as string);

		if (!originalImage) {
			originalImage = await loadImage(originalFilePath, env);
		}

		const resultData: Partial<ImageData> = {
			data: undefined,
			expires: originalImage.expires,
			etag: originalImage.etag,
			lastModified: originalImage.lastModified,
		};

		const imageService =
			(await getConfiguredImageService()) as LocalImageService;

		try {
			resultData.data = (
				await imageService.transform(
					originalImage.data,
					{ ...options, src: originalImagePath },
					env.imageConfig,
				)
			).data;
		} catch (e) {
			throw new Error("Could not transform image.", { cause: e });
		}

		try {
			// Write the cache entry
			if (env.useCache) {
				if (isLocalImage) {
					await fs.promises.writeFile(cachedFileURL, resultData.data);
				} else {
					await Promise.all([
						fs.promises.writeFile(cachedFileURL, resultData.data),
						writeCacheMetaFile(cachedMetaFileURL, resultData as ImageData, env),
					]);
				}
			}
		} catch (e) {
			env.logger.warn(
				`An error was encountered while creating the cache directory. Proceeding without caching. Error: ${e}`,
			);
		} finally {
			// Write the final file
			await fs.promises.writeFile(finalFileURL, resultData.data);
		}

		return {
			cached: "miss",
			weight: {
				// Divide by 1024 to get size in kilobytes
				before: Math.trunc(originalImage.data.byteLength / 1024),
				after: Math.trunc(Buffer.from(resultData.data).byteLength / 1024),
			},
		};
	}
}

async function writeCacheMetaFile(
	cachedMetaFileURL: string,
	resultData: Omit<ImageData, "data">,
	env: AssetEnv,
) {
	try {
		return await fs.promises.writeFile(
			cachedMetaFileURL,
			JSON.stringify({
				expires: resultData.expires,
				etag: resultData.etag,
				lastModified: resultData.lastModified,
			}),
			"utf-8",
		);
	} catch (e) {
		env.logger.warn(
			`An error was encountered while writing the cache file for a remote asset. Proceeding without caching this asset. Error: ${e}`,
		);
	}
}

export function getStaticImageList(): AssetsGlobalStaticImagesList {
	if (!globalThis?.astroAsset?.staticImages) {
		return new Map();
	}

	return globalThis.astroAsset.staticImages;
}

async function loadImage(path: string, env: AssetEnv): Promise<ImageData> {
	if (isRemotePath(path)) {
		return await loadRemoteImage(path, undefined, env.imageConfig);
	}

	return {
		data: await fs.promises.readFile(getFullImagePath(path, env)),
		expires: 0,
	};
}
