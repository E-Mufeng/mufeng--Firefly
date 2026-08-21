import type { GalleryConfig } from "@/types/galleryConfig";

// 相册配置
export const galleryConfig: GalleryConfig = {
	// 相册列表
	albums: [
		{
			id: "mufeng-daily",
			name: "日常",
			description: "记录生活里的光和影。",
			location: "湖南",
			date: "2026-08-22",
			tags: ["日常", "随拍"],
		},
		{
			id: "mufeng-private",
			name: "私人相册",
			description: "加密相册。",
			date: "2026-08-22",
			tags: ["私密"],
			password: "Mufeng",
			passwordHint: "Mufeng",
		},
	],

	// 瀑布流最小列宽(px)，浏览器根据容器宽度自动计算列数，默认 240
	// 值越小列数越多，值越大列数越少
	columnWidth: 240,
};
