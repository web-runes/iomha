declare module "*.gif" {
	const metadata: import("@iomha/temp/v2").ImageMetadata;
	export default metadata;
}
declare module "*.jpeg" {
	const metadata: import("@iomha/temp/v2").ImageMetadata;
	export default metadata;
}
declare module "*.jpg" {
	const metadata: import("@iomha/temp/v2").ImageMetadata;
	export default metadata;
}
declare module "*.png" {
	const metadata: import("@iomha/temp/v2").ImageMetadata;
	export default metadata;
}
declare module "*.tiff" {
	const metadata: import("@iomha/temp/v2").ImageMetadata;
	export default metadata;
}
declare module "*.webp" {
	const metadata: import("@iomha/temp/v2").ImageMetadata;
	export default metadata;
}
declare module "*.avif" {
	const metadata: import("@iomha/temp/v2").ImageMetadata;
	export default metadata;
}

declare module "astro:assets" {
	export const getImage: (
		options: import("../node_modules/@iomha/temp/dist/v2/types.js").UnresolvedImageTransform,
	) => Promise<
		import("../node_modules/@iomha/temp/dist/v2/types.js").GetImageResult
	>;
}
