import { DEFAULT_HASH_PROPS } from "./consts.js";
import { isRemotePath } from "./internal-helpers/path.js";
import { isRemoteAllowed } from "./internal-helpers/remote.js";
import {
	DEFAULT_RESOLUTIONS,
	getSizesAttribute,
	getWidths,
	LIMITED_RESOLUTIONS,
} from "./layout.js";
import { type ImageService, isLocalService } from "./services/service.js";
import {
	type GetImageResult,
	type ImageTransform,
	isImageMetadata,
	type ResolvedImageConfig,
	type SrcSetValue,
	type UnresolvedImageTransform,
} from "./types.js";
import {
	isESMImportedImage,
	isRemoteImage,
	resolveSrc,
} from "./utils/imageKind.js";
import { inferRemoteSize } from "./utils/remoteProbe.js";

export { isLocalService, verifyOptions } from "./services/service.js";
export const cssFitValues = [
	"fill",
	"contain",
	"cover",
	"scale-down",
	"none",
] as const;

export async function getConfiguredImageService(): Promise<ImageService> {
	if (!globalThis?.astroAsset?.imageService) {
		const { default: service }: { default: ImageService } = await import(
			// @ts-expect-error
			"virtual:image-service"
		).catch((e) => {
			const error = new Error("Error while loading image service.");
			error.cause = e;
			throw error;
		});

		if (!globalThis.astroAsset) globalThis.astroAsset = {};
		globalThis.astroAsset.imageService = service;
		return service;
	}

	return globalThis.astroAsset.imageService;
}

export async function getImage(
	options: UnresolvedImageTransform,
	imageConfig: ResolvedImageConfig,
): Promise<GetImageResult> {
	if (!options || typeof options !== "object") {
		throw new Error("Expected image options.");
	}
	if (typeof options.src === "undefined") {
		throw new Error("Expected src to be an image.");
	}

	if (isImageMetadata(options)) {
		throw new Error("Expected image options, not an ESM-imported image.");
	}

	const service = await getConfiguredImageService();

	// If the user inlined an import, something fairly common especially in MDX, or passed a function that returns an Image, await it for them
	const resolvedOptions: ImageTransform = {
		...options,
		src: await resolveSrc(options.src),
	};

	let originalWidth: number | undefined;
	let originalHeight: number | undefined;

	// Infer size for remote images if inferSize is true
	if (resolvedOptions.inferSize) {
		delete resolvedOptions.inferSize; // Delete so it doesn't end up in the attributes

		if (
			isRemoteImage(resolvedOptions.src) &&
			isRemotePath(resolvedOptions.src)
		) {
			if (!isRemoteAllowed(resolvedOptions.src, imageConfig)) {
				throw new Error("Remote image is not allowed");
			}

			const getRemoteSize = (url: string) =>
				service.getRemoteSize?.(url, imageConfig) ??
				inferRemoteSize(url, imageConfig);
			const result = await getRemoteSize(resolvedOptions.src); // Directly probe the image URL
			resolvedOptions.width ??= result.width;
			resolvedOptions.height ??= result.height;
			originalWidth = result.width;
			originalHeight = result.height;
		}
	}

	const originalFilePath = isESMImportedImage(resolvedOptions.src)
		? resolvedOptions.src.fsPath
		: undefined; // Only set for ESM imports, where we do have a file path

	// Clone the `src` object if it's an ESM import so that we don't refer to any properties of the original object
	// Causing our generate step to think the image is used outside of the image optimization pipeline
	const clonedSrc = isESMImportedImage(resolvedOptions.src)
		? // @ts-expect-error - clone is a private, hidden prop
			(resolvedOptions.src.clone ?? resolvedOptions.src)
		: resolvedOptions.src;

	if (isESMImportedImage(clonedSrc)) {
		originalWidth = clonedSrc.width;
		originalHeight = clonedSrc.height;
	}

	if (originalWidth && originalHeight) {
		// Calculate any missing dimensions from the aspect ratio, if available
		const aspectRatio = originalWidth / originalHeight;
		if (resolvedOptions.height && !resolvedOptions.width) {
			resolvedOptions.width = Math.round(resolvedOptions.height * aspectRatio);
		} else if (resolvedOptions.width && !resolvedOptions.height) {
			resolvedOptions.height = Math.round(resolvedOptions.width / aspectRatio);
		} else if (!resolvedOptions.width && !resolvedOptions.height) {
			resolvedOptions.width = originalWidth;
			resolvedOptions.height = originalHeight;
		}
	}
	resolvedOptions.src = clonedSrc;

	const layout = options.layout ?? imageConfig.layout ?? "none";

	if (resolvedOptions.priority) {
		resolvedOptions.loading ??= "eager";
		resolvedOptions.decoding ??= "sync";
		resolvedOptions.fetchpriority ??= "high";
		delete resolvedOptions.priority;
	} else {
		resolvedOptions.loading ??= "lazy";
		resolvedOptions.decoding ??= "async";
		// Omit fetchpriority to use the default `"auto"` value
		resolvedOptions.fetchpriority ??= undefined;
	}

	if (layout !== "none") {
		resolvedOptions.widths ||= getWidths({
			width: resolvedOptions.width,
			layout,
			originalWidth,
			breakpoints: imageConfig.breakpoints?.length
				? imageConfig.breakpoints
				: isLocalService(service)
					? LIMITED_RESOLUTIONS
					: DEFAULT_RESOLUTIONS,
		});
		resolvedOptions.sizes ||= getSizesAttribute({
			width: resolvedOptions.width,
			layout,
		});
		// The densities option is incompatible with the `layout` option
		delete resolvedOptions.densities;

		// Set data attribute for layout
		resolvedOptions["data-astro-image"] = layout;

		// Set data attributes for fit and position for CSP-compliant styling
		if (resolvedOptions.fit && cssFitValues.includes(resolvedOptions.fit)) {
			resolvedOptions["data-astro-image-fit"] = resolvedOptions.fit;
		}

		// Always output 'data-astro-image-pos', defaulting to 'center' if unspecified.
		// This ensures compatibility with existing CSP tests and allows consistent CSS control.
		const currentPosition = resolvedOptions.position || "center";
		resolvedOptions["data-astro-image-pos"] = currentPosition.replace(
			/\s+/g,
			"-",
		);

		if (resolvedOptions.position) {
			// Normalize position value for data attribute (spaces to dashes)
			// Apply object-position as inline style since position values are arbitrary
			// and cannot be pre-enumerated in a static stylesheet like fit values can.
			if (
				typeof resolvedOptions.style === "object" &&
				resolvedOptions.style !== null
			) {
				if (!("objectPosition" in resolvedOptions.style)) {
					resolvedOptions.style = {
						...resolvedOptions.style,
						objectPosition: resolvedOptions.position,
					};
				}
			} else {
				const existingStyle =
					typeof resolvedOptions.style === "string"
						? resolvedOptions.style
						: "";
				if (!existingStyle.includes("object-position")) {
					const positionStyle = `object-position: ${resolvedOptions.position}`;
					resolvedOptions.style = existingStyle
						? existingStyle.replace(/;?\s*$/, "; ") + positionStyle
						: positionStyle;
				}
			}
		}
	}

	const validatedOptions = service.validateOptions
		? await service.validateOptions(resolvedOptions, imageConfig)
		: resolvedOptions;

	// Get all the options for the different srcSets
	const srcSetTransforms = service.getSrcSet
		? await service.getSrcSet(validatedOptions, imageConfig)
		: [];

	// In the Picture component, the optimized original-sized image is typically not used when `widths` is set.
	// Since `globalThis.astroAsset.addStaticImage()` triggers image generation immediately,
	// we fetch it lazily to avoid creating unnecessary assets.
	const lazyImageURLFactory = (getValue: () => string) => {
		let cached: string | null = null;
		return () => (cached ??= getValue());
	};
	const initialImageURL = await service.getURL(validatedOptions, imageConfig);
	let lazyImageURL = lazyImageURLFactory(() => initialImageURL);

	const matchesValidatedTransform = (transform: ImageTransform) =>
		transform.width === validatedOptions.width &&
		transform.height === validatedOptions.height &&
		transform.format === validatedOptions.format;

	let srcSets: SrcSetValue[] = await Promise.all(
		srcSetTransforms.map(async (srcSet) => {
			return {
				transform: srcSet.transform,
				url: matchesValidatedTransform(srcSet.transform)
					? initialImageURL
					: await service.getURL(srcSet.transform, imageConfig),
				descriptor: srcSet.descriptor,
				attributes: srcSet.attributes,
			};
		}),
	);

	if (
		isLocalService(service) &&
		globalThis.astroAsset.addStaticImage &&
		!(
			isRemoteImage(validatedOptions.src) &&
			initialImageURL === validatedOptions.src
		)
	) {
		const propsToHash = service.propertiesToHash ?? DEFAULT_HASH_PROPS;
		lazyImageURL = lazyImageURLFactory(() =>
			// biome-ignore lint/style/noNonNullAssertion: it's fine
			globalThis.astroAsset.addStaticImage!(
				validatedOptions,
				propsToHash,
				originalFilePath,
			),
		);
		srcSets = srcSetTransforms.map((srcSet) => {
			return {
				transform: srcSet.transform,
				url: matchesValidatedTransform(srcSet.transform)
					? lazyImageURL()
					: // biome-ignore lint/style/noNonNullAssertion: it's fine
						globalThis.astroAsset.addStaticImage!(
							srcSet.transform,
							propsToHash,
							originalFilePath,
						),
				descriptor: srcSet.descriptor,
				attributes: srcSet.attributes,
			};
		});
	}

	return {
		rawOptions: resolvedOptions,
		options: validatedOptions,
		get src() {
			return lazyImageURL();
		},
		srcSet: {
			values: srcSets,
			attribute: srcSets
				.map((srcSet) => `${srcSet.url} ${srcSet.descriptor}`)
				.join(", "),
		},
		attributes:
			service.getHTMLAttributes !== undefined
				? await service.getHTMLAttributes(validatedOptions, imageConfig)
				: {},
	};
}
