import * as mime from "mrmime";
import type {
	AvifOptions,
	FitEnum,
	FormatEnum,
	JpegOptions,
	PngOptions,
	ResizeOptions,
	SharpOptions,
	WebpOptions,
} from "sharp";
import { etag } from "./etag.js";
import { isRemotePath } from "./path.js";
import { fetchWithRedirects } from "./redirectValidation.js";
import { isRemoteAllowed, type RemotePattern } from "./remote.js";
import { detector } from "../../node_modules/image-size/dist/detector.mjs";

async function loadRemoteImage(src: URL, headers: Headers, options: Options) {
	try {
		const res = await fetchWithRedirects({ url: src, headers, options });

		// Validate that the final URL (after redirects) is allowed
		if (!isRemoteAllowed(res.url, options)) {
			return undefined;
		}

		if (!res.ok) {
			return undefined;
		}

		return await res.arrayBuffer();
	} catch {
		return undefined;
	}
}

export interface Options {
	domains?: string[];
	remotePatterns?: RemotePattern[];
	/**
	 * The `limitInputPixels` option passed to Sharp. See https://sharp.pixelplumbing.com/api-constructor for more information
	 */
	limitInputPixels?: SharpOptions["limitInputPixels"];

	/**
	 * The `kernel` option is passed to resize calls. See https://sharp.pixelplumbing.com/api-resize/ for more information
	 */
	kernel?: ResizeOptions["kernel"];

	/**
	 * The default encoder options passed to `sharp().jpeg()`.
	 */
	jpeg?: JpegOptions;

	/**
	 * The default encoder options passed to `sharp().png()`.
	 */
	png?: PngOptions;

	/**
	 * The default encoder options passed to `sharp().webp()`.
	 */
	webp?: WebpOptions;

	/**
	 * The default encoder options passed to `sharp().avif()`.
	 */
	avif?: AvifOptions;

	dangerouslyProcessSVG?: boolean;
}

interface ImageTransform {
	src?: string;
	width?: number;
	height?: number;
	format?: string | null;
	quality?: string | number | null;
	fit?: string | null;
	position?: string;
	background?: string;
}

async function parseURL(
	url: URL,
	_options: Options,
): Promise<ImageTransform | undefined> {
	const params = url.searchParams;

	if (!params.has("href")) {
		return undefined;
	}

	return {
		// biome-ignore lint/style/noNonNullAssertion: fine
		src: params.get("href")!,
		// biome-ignore lint/style/noNonNullAssertion: fine
		width: params.has("w") ? Number.parseInt(params.get("w")!, 10) : undefined,
		// biome-ignore lint/style/noNonNullAssertion: fine
		height: params.has("h") ? Number.parseInt(params.get("h")!, 10) : undefined,
		format: params.get("f"),
		quality: params.get("q"),
		fit: params.get("fit"),
		position: params.get("position") ?? undefined,
		background: params.get("background") ?? undefined,
	};
}

let sharp: typeof import("sharp");

async function loadSharp() {
	let sharpImport: typeof import("sharp");
	try {
		sharpImport = (await import("sharp")).default;
	} catch {
		throw new Error("missing sharp");
	}

	// Disable the `sharp` `libvips` cache as it errors when the file is too small and operations are happening too fast (runs into a race condition) https://github.com/lovell/sharp/issues/3935#issuecomment-1881866341
	sharpImport.cache(false);

	return sharpImport;
}

const fitMap: Record<string, keyof FitEnum> = {
	fill: "fill",
	contain: "inside",
	cover: "cover",
	none: "outside",
	"scale-down": "inside",
	outside: "outside",
	inside: "inside",
};

const qualityTable: Record<string, number> = {
	low: 25,
	mid: 50,
	high: 80,
	max: 100,
};

export function parseQuality(quality: string): string | number {
	const result = Number.parseInt(quality, 10);
	if (Number.isNaN(result)) {
		return quality;
	}

	return result;
}

function resolveSharpQuality(quality: string): number | undefined {
	if (!quality) return undefined;

	const parsedQuality = parseQuality(quality);
	if (typeof parsedQuality === "number") {
		return parsedQuality;
	}

	return quality in qualityTable ? qualityTable[quality] : undefined;
}

export function resolveSharpEncoderOptions(
	transform: Pick<ImageTransform, "format" | "quality">,
	inputFormat: string | undefined,
	serviceConfig: Options = {},
):
	| JpegOptions
	| PngOptions
	| WebpOptions
	| AvifOptions
	| { quality?: number }
	| undefined {
	// TODO: figure out
	// @ts-expect-error
	const quality = resolveSharpQuality(transform.quality);

	switch (transform.format) {
		case "jpg":
		case "jpeg":
			return {
				...serviceConfig.jpeg,
				...(quality === undefined ? {} : { quality }),
			};
		case "png":
			return {
				...serviceConfig.png,
				...(quality === undefined ? {} : { quality }),
			};
		case "webp": {
			const webpOptions: WebpOptions = {
				...serviceConfig.webp,
				...(quality === undefined ? {} : { quality }),
			};
			if (inputFormat === "gif") {
				webpOptions.loop ??= 0;
			}
			return webpOptions;
		}
		case "avif":
			return {
				...serviceConfig.avif,
				...(quality === undefined ? {} : { quality }),
			};
		default:
			return quality === undefined ? undefined : { quality };
	}
}

async function transform(
	inputBuffer: Uint8Array<ArrayBuffer>,
	transform: ImageTransform,
	options: Options,
): Promise<{
	data: Uint8Array<ArrayBuffer>;
	format: string;
}> {
	if (!sharp) sharp = await loadSharp();
	const { kernel } = options;

	if (transform.format === "svg")
		// Return SVGs as-is
		// TODO: Sharp has some support for SVGs, we could probably support this once Sharp is the default and only service.
		return { data: inputBuffer, format: "svg" };

	if (detector(inputBuffer) === "svg" && !options.dangerouslyProcessSVG) {
		// Rasterizing an SVG runs librsvg on untrusted input; require explicit opt-in.
		throw new Error(
			"SVG image processing is disabled. Set `image.dangerouslyProcessSVG: true` to allow processing of SVG sources.",
		);
	}

	const result = sharp(inputBuffer, {
		failOnError: false,
		pages: -1,
		limitInputPixels: options.limitInputPixels,
	});

	// always call rotate to adjust for EXIF data orientation
	result.rotate();
	// get some information about the input
	let format: string | undefined;
	try {
		({ format } = await result.metadata());
	} catch {
		// Sharp cannot decode this image (e.g. animated AVIF sequences).
		// Pass it through unmodified rather than crashing the build. When Sharp adds support for these
		// formats, the image will be optimized automatically without code changes.
		console.warn(
			`⚠️  Astro could not optimize image "${transform.src}". ` +
				`Sharp doesn't support this format. The image will be used unoptimized. ` +
				`Consider converting to WebP or placing in the public/ folder.`,
		);
		// TODO: figure out
		// @ts-expect-error
		return { data: inputBuffer, format: transform.format };
	}

	if (transform.width && transform.height) {
		const fit: keyof FitEnum | undefined = transform.fit
			? (fitMap[transform.fit] ?? "inside")
			: undefined;

		result.resize({
			width: Math.round(transform.width),
			height: Math.round(transform.height),
			kernel,
			fit,
			position: transform.position,
			withoutEnlargement: true,
		});
	} else if (transform.height && !transform.width) {
		result.resize({
			height: Math.round(transform.height),
			withoutEnlargement: true,
			kernel,
		});
	} else if (transform.width) {
		result.resize({
			width: Math.round(transform.width),
			withoutEnlargement: true,
			kernel,
		});
	}

	if (transform.background) {
		// If background is set, flatten the image with the specified background.
		// We do this after resize to ensure the background covers the entire image
		// even if its size has expanded.
		result.flatten({ background: transform.background });
	}

	if (transform.format) {
		const encoderOptions = resolveSharpEncoderOptions(
			transform,
			format,
			options,
		);

		if (transform.format === "webp" && format === "gif") {
			// Convert animated GIF to animated WebP with loop=0 (infinite) unless overridden in config.
			result.webp(encoderOptions as WebpOptions | undefined);
		} else if (transform.format === "webp") {
			result.webp(encoderOptions as WebpOptions | undefined);
		} else if (transform.format === "png") {
			result.png(encoderOptions as PngOptions | undefined);
		} else if (transform.format === "avif") {
			result.avif(encoderOptions as AvifOptions | undefined);
		} else if (transform.format === "jpeg" || transform.format === "jpg") {
			result.jpeg(encoderOptions as JpegOptions | undefined);
		} else {
			result.toFormat(transform.format as keyof FormatEnum, encoderOptions);
		}
	}

	const { data, info } = await result.toBuffer({ resolveWithObject: true });

	// Sharp can sometimes return a SharedArrayBuffer when using WebAssembly.
	// SharedArrayBuffers need to be copied into an ArrayBuffer in order to be manipulated.
	const needsCopy =
		"buffer" in data && data.buffer instanceof SharedArrayBuffer;

	return {
		// @ts-expect-error
		data: needsCopy ? new Uint8Array(data) : data,
		format: info.format,
	};
}

export async function endpoint(
	request: Request,
	options: Options,
): Promise<Response> {
	try {
		const url = new URL(request.url);
		const imageTransform = await parseURL(url, options);

		if (!imageTransform?.src) {
			throw new Error("Incorrect transform returned by `parseURL`");
		}

		const isRemoteImage = isRemotePath(imageTransform.src);

		if (
			isRemoteImage &&
			isRemoteAllowed(imageTransform.src, options) === false
		) {
			return new Response("Forbidden", { status: 403 });
		}

		const sourceUrl = new URL(imageTransform.src, url.origin);

		// Have we been tricked into thinking this is local?
		if (!isRemoteImage && sourceUrl.origin !== url.origin) {
			return new Response("Forbidden", { status: 403 });
		}

		const inputBuffer = await loadRemoteImage(
			sourceUrl,
			isRemoteImage ? new Headers() : request.headers,
			options,
		);

		if (!inputBuffer) {
			return new Response("Not Found", { status: 404 });
		}

		const { data, format } = await transform(
			new Uint8Array(inputBuffer),
			imageTransform,
			options,
		);

		return new Response(data, {
			status: 200,
			headers: {
				"Content-Type": mime.lookup(format) ?? `image/${format}`,
				"Cache-Control": "public, max-age=31536000",
				ETag: etag(data.toString()),
				Date: new Date().toUTCString(),
			},
		});
	} catch (err: unknown) {
		console.error("Could not process image request:", err);
		return new Response("Internal Server Error", { status: 500 });
	}
}
