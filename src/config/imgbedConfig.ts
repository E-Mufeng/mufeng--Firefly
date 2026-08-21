export interface ImgbedImage {
	id: string;
	title: string;
	src: string;
	type?: "image" | "video";
	category: string;
	tags?: string[];
}

// 图床图片清单：后续新增素材只需在这里追加一条记录。
export const imgbedImages: ImgbedImage[] = [
	{
		id: "gojo-wallpaper",
		title: "五条悟 壁纸",
		src: "/imgbed/gojo-3.jpg",
		category: "壁纸",
		tags: ["五条悟"],
	},
	{
		id: "gojo-video",
		title: "五条悟 动态 MP4",
		src: "https://static.6261025.xyz/videos/wallpaper-gojo.mp4",
		type: "video",
		category: "动态",
		tags: ["动态", "五条悟"],
	},
];

export const imgbedCategories = [
	"全部",
	...new Set(imgbedImages.map((item) => item.category)),
];
