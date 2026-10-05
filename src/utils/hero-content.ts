/**
 * hero-content.ts — 首页 3D 角色场景的内容数据（纯数据，无 three 依赖）
 *
 * 角色、技能、口头禅都在这里维护，方便随时增改。
 * 视觉/交互逻辑在 hero-character-scene.ts。
 */

export interface QuoteLine {
	/** 主句（日文原声，更有那味儿） */
	main: string;
	/** 中文释义，小字展示 */
	sub?: string;
}

export interface SkillDef {
	/** 触发 key，传给 controller.castSkill */
	key: "blue" | "red" | "purple";
	/** 按钮上的汉字 */
	label: string;
	/** 粒子/光的颜色（hex number，给 three 用） */
	color: number;
	/** 副标题 */
	desc: string;
}

export type HeroPose = "signature" | "calm" | "ready";

export interface CharacterConfig {
	id: string;
	/** 显示名 */
	name: string;
	/** 名字下方的小标题 */
	title: string;
	/** 发色 */
	hairColor: number;
	/** 头发自发光（六眼/咒力微光），0 表示无 */
	hairEmissive: number;
	/** 肤色 */
	skinColor: number;
	/** 瞳色（六眼/角色眼色，MeshBasicMaterial 高亮不受光） */
	eyeColor: number;
	/** 制服主色 */
	uniformColor: number;
	/** 是否戴绷带眼罩（五条悟标志性） */
	blindfold: boolean;
	/** 是否露出六眼（蓝芒，不戴眼罩） */
	sixEyes: boolean;
	/** 角色光环/补光主色 */
	auraColor: number;
	/** 点缀色（地面环、UI） */
	accentColor: number;
	/** 姿势 */
	pose: HeroPose;
	/** 点击角色时随机弹出的口头禅 */
	lines: QuoteLine[];
}

export const SKILLS: SkillDef[] = [
	{ key: "blue", label: "蒼", color: 0x4f9dff, desc: "収束する虚式・蒼" },
	{ key: "red", label: "赫", color: 0xff4d4d, desc: "展延する虚式・赫" },
	{ key: "purple", label: "茈", color: 0xb15bff, desc: "蒼と赫の融合・茈" },
];

export const CHARACTERS: CharacterConfig[] = [
	{
		id: "gojo",
		name: "五条悟",
		title: "最強の呪術師",
		hairColor: 0xeef2f8,
		hairEmissive: 0x8fb6ff,
		skinColor: 0xf6e3cc,
		eyeColor: 0x4fc3ff,
		uniformColor: 0x3a4670,
		blindfold: false,
		sixEyes: true,
		auraColor: 0x5b9dff,
		accentColor: 0x9ec5ff,
		pose: "signature",
		lines: [
			{ main: "俺は最強だ。", sub: "我，是最强的。" },
			{ main: "正しさとは、強者が決めるものだ。", sub: "所谓正确，由强者来定义。" },
			{ main: "やっほー、五条です！", sub: "呀嚯——我是五条！" },
			{ main: "無限を、理解したか？", sub: "你，理解无限了吗？" },
			{ main: "オマエのこと、守るのはオレだ。", sub: "要保护你的，是我。" },
			{ main: "弱者には救いを、強者には制裁を。", sub: "对弱者施以救赎，对强者加以制裁。" },
			{ main: "リスペクト、リスペクト！", sub: "respect，respect！" },
			{ main: "この世で一番、お前を守るのはオレだ。", sub: "这世上最想守护你的，是我。" },
		],
	},
	{
		id: "megumi",
		name: "伏黑惠",
		title: "禪院の御曹司",
		hairColor: 0x161a22,
		hairEmissive: 0x000000,
		skinColor: 0xf0d3b8,
		eyeColor: 0x2f6b4f,
		uniformColor: 0x2a3040,
		blindfold: false,
		sixEyes: false,
		auraColor: 0x9b6bff,
		accentColor: 0xc4a3ff,
		pose: "calm",
		lines: [
			{ main: "俺は、正しく死ぬために生きてる。", sub: "我为了正确地死去而活着。" },
			{ main: "何が正しいか、自分で決める。", sub: "什么才是正确，由我自己决定。" },
			{ main: "十種影法術、召喚。", sub: "十种影法术，召唤。" },
		],
	},
	{
		id: "nobara",
		name: "钉崎野蔷薇",
		title: "呪術高専 1 年",
		hairColor: 0xb5562e,
		hairEmissive: 0x000000,
		skinColor: 0xf3d6bd,
		eyeColor: 0x8a5a2a,
		uniformColor: 0x33303f,
		blindfold: false,
		sixEyes: false,
		auraColor: 0xff5b7a,
		accentColor: 0xffa6b8,
		pose: "ready",
		lines: [
			{ main: "男なんて、信じないわ。", sub: "男人什么的，才不信。" },
			{ main: "私、勝つわ。", sub: "我，会赢的。" },
			{ main: "お館様、やります！", sub: "馆长，我上了！" },
		],
	},
];
