export const VIRTUAL_MODULE_ID = "astro:assets";
export const RESOLVED_VIRTUAL_MODULE_ID: string = `\0${VIRTUAL_MODULE_ID}`;
export const VIRTUAL_SERVICE_ID = "virtual:image-service";
// Internal virtual module that exports only getImage (no component references).
// Used by the content runtime to avoid a TDZ when Picture/Image are in the same chunk.
export const VIRTUAL_GET_IMAGE_ID = "virtual:astro:get-image";
export const RESOLVED_VIRTUAL_GET_IMAGE_ID: string = `\0${VIRTUAL_GET_IMAGE_ID}`;
// Must keep the extension so we trigger the pipeline of CSS files
export const VIRTUAL_IMAGE_STYLES_ID = "virtual:astro:image-styles.css";
export const RESOLVED_VIRTUAL_IMAGE_STYLES_ID: string = `\0${VIRTUAL_IMAGE_STYLES_ID}`;
export const VALID_INPUT_FORMATS = [
	"jpeg",
	"jpg",
	"png",
	"tiff",
	"webp",
	"gif",
	"svg",
	"avif",
] as const;
/**
 * Valid formats that our base services support.
 * Certain formats can be imported (namely SVGs) but will not be processed.
 */
export const VALID_SUPPORTED_FORMATS = [
	"jpeg",
	"jpg",
	"png",
	"tiff",
	"webp",
	"gif",
	"svg",
	"avif",
] as const;
export const DEFAULT_OUTPUT_FORMAT = "webp" as const;
export const VALID_OUTPUT_FORMATS = [
	"avif",
	"png",
	"webp",
	"jpeg",
	"jpg",
	"svg",
] as const;
export const DEFAULT_HASH_PROPS: Array<string> = [
	"src",
	"width",
	"height",
	"format",
	"quality",
	"fit",
	"position",
	"background",
];

// The environments used inside Astro
export const ASTRO_VITE_ENVIRONMENT_NAMES = {
	// It maps to the classic `ssr` Vite environment
	ssr: "ssr",
	// It maps to the classic `client` Vite environment
	client: "client",
	// Use this environment when `ssr` isn't a runnable dev environment, and you need
	// a runnable dev environment. A runnable dev environment allows you, for example,
	// to load a module via `runner.import`.
	//
	// This environment should be used only for dev, not production.
	astro: "astro",
	// Environment used during the build for rendering static pages.
	// If your plugin runs in `ASTRO_VITE_ENVIRONMENT_NAMES.ssr`, you might
	// want to add `ASTRO_VITE_ENVIRONMENT_NAMES.prerender` too
	prerender: "prerender",
} as const;
