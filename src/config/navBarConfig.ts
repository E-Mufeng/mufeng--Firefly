import {
	type NavBarConfig,
	type NavBarLink,
	type NavBarSearchConfig,
	NavBarSearchMethod,
} from "../types/navBarConfig";
import { booknavConfig } from "./booknavConfig";
import navbarData from "./data/navbar.json";

type NavBarJsonLink = Omit<NavBarLink, "children"> & {
	children?: NavBarLink[];
	childrenSource?: "booknav";
};

// 导航栏配置：骨架数据存放在 src/config/data/navbar.json
const getDynamicNavBarConfig = (): NavBarConfig => {
	const booknavCategoryLinks: NavBarLink[] = booknavConfig
		.filter((group) => group.enabled !== false)
		.map((group) => ({
			name: group.name,
			url: `/website-nav/#${group.id}`,
			icon: group.icon,
		}));

	const links: NavBarLink[] = (navbarData.links as NavBarJsonLink[]).map(
		(link) => {
			if (link.childrenSource === "booknav") {
				const { childrenSource: _source, ...base } = link;
				return { ...base, children: booknavCategoryLinks };
			}
			return link;
		},
	);

	return { links } as NavBarConfig;
};

// 导航搜索配置
export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};

// ============================================================================
// 链接预设 - 可自由自定义导航栏链接的名称、图标和URL
// Link Presets - Allows free customization of the name, icon, and URL of navigation bar links
// ============================================================================
export const LinkPresets: Record<string, NavBarLink> = {
	Home: {
		name: "主页",
		url: "/",
		icon: "material-symbols:home",
	},
	Archive: {
		name: "归档",
		url: "/archive/",
		icon: "material-symbols:archive",
	},
	Categories: {
		name: "分类",
		url: "/categories/",
		icon: "material-symbols:folder-open-rounded",
	},
	Tags: {
		name: "标签",
		url: "/tags/",
		icon: "material-symbols:tag-rounded",
	},
	Friends: {
		name: "友链",
		url: "/friends/",
		icon: "material-symbols:link-2-rounded",
		pageKey: "friends",
	},
	Guestbook: {
		name: "留言",
		url: "/guestbook/",
		icon: "material-symbols:chat",
		pageKey: "guestbook",
	},
	Dynamic: {
		name: "动态",
		url: "/dynamic/",
		icon: "material-symbols:forum-rounded",
		pageKey: "dynamic",
	},
	Gallery: {
		name: "相册",
		url: "/gallery/",
		icon: "material-symbols:photo-library",
		pageKey: "gallery",
	},
	Booknav: {
		name: "网站导航",
		url: "/website-nav/",
		icon: "material-symbols:bookmarks",
		pageKey: "booknav",
	},
	Records: {
		name: "记录",
		url: "/records/",
		icon: "material-symbols:edit-note-rounded",
	},
	Bilibili: {
		name: "哔哩哔哩",
		url: "/bilibili/",
		icon: "fa7-brands:bilibili",
		pageKey: "bilibili",
	},
	Bangumi: {
		name: "番组计划",
		url: "/bangumi/",
		icon: "material-symbols:movie",
		pageKey: "bangumi",
	},
	VNDB: {
		name: "VNDB",
		url: "/vndb/",
		icon: "material-symbols:chrome-reader-mode-rounded",
		pageKey: "vndb",
	},
	MAL: {
		name: "AnimeList",
		url: "/myanimelist/",
		icon: "material-symbols:menu-book",
		pageKey: "mal",
	},
	Sponsor: {
		name: "打赏",
		url: "/sponsor/",
		icon: "material-symbols:favorite",
		pageKey: "sponsor",
	},
	About: {
		name: "关于我",
		url: "/about/",
		icon: "material-symbols:person",
	},
};

export const navBarConfig: NavBarConfig = getDynamicNavBarConfig();
