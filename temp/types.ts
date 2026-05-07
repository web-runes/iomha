export type ImageFormat =
  | "jpeg"
  | "jpg"
  | "png"
  | "tiff"
  | "webp"
  | "gif"
  | "svg"
  | "avif";

export interface ImageMetadata {
  src: string;
  width: number;
  height: number;
  format: ImageFormat;
}

export type ImageQualityPreset = "low" | "mid" | "high" | "max";

export type ImageQuality = ImageQualityPreset | number;

export type ImageFit = "fill" | "contain" | "cover" | "none" | "scale-down";

export interface ImageTransform {
  src: ImageMetadata | string;
  width?: number | undefined;
  widths?: number[] | undefined;
  densities?: (number | `${number}x`)[] | undefined;
  height?: number | undefined;
  quality?: ImageQuality | undefined;
  format?: ImageFormat | undefined;
  fit?: ImageFit | undefined;
  position?: string | undefined;
  background?: string | undefined;
  [key: string]: any;
}

export interface RemoteImageProvider<TOptions> {
  name: string;
  // include conditionally
  options?: TOptions;
  validateOptions?: (options: ImageTransform) => ImageTransform;
  getURL: (options: ImageTransform) => string;
}

interface TestOptions {
  foo?: "bar";
}

function testProvider(
  options: TestOptions = {},
): RemoteImageProvider<TestOptions> {
  return {
    name: "test",
    options,
    getURL(options) {
      return `https://foo.bar/_image/?w=${options.width}`;
    },
  };
}
