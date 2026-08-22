import imgbedData from "./data/imgbed.json";

export interface ImgbedImage {
	id: string;
	title: string;
	src: string;
	type?: "image" | "video";
	category: string;
	tags?: string[];
}

// 图床图片清单：数据统一存放在 src/config/data/imgbed.json
export const imgbedImages = imgbedData.images as ImgbedImage[];

export const imgbedCategories = [
	"全部",
	...new Set(imgbedImages.map((item) => item.category)),
];
