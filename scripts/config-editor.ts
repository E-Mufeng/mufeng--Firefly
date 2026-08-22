/**
 * 沐风本地配置编辑器（v0.1）
 * 只在本机运行，不随站点发布，用于维护 src/config/data 下的 JSON 配置。
 * 用法：
 *   pnpm config:edit         交互式编辑
 *   npx tsx scripts/config-editor.ts --list   仅查看当前配置摘要
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { pinyin } from "pinyin-pro";
import { siteConfig } from "../src/config/siteConfig.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rl = createInterface({ input, output });

type Field = {
	key: string;
	label: string;
	type?: "string" | "number" | "boolean" | "tags";
	required?: boolean;
};

type ConfigEntry = {
	key: string;
	file: string;
	title: string;
	summary: (data: Record<string, unknown>) => string;
};

const configs: ConfigEntry[] = [
	{
		key: "booknav",
		file: "src/config/data/booknav.json",
		title: "网站导航",
		summary: (data) => {
			const groups = (data.groups || []) as { name: string; items?: unknown[] }[];
			return groups
				.map((g) => `${g.name}(${g.items?.length ?? 0})`)
				.join("、");
		},
	},
	{
		key: "imgbed",
		file: "src/config/data/imgbed.json",
		title: "图床",
		summary: (data) => {
			const images = (data.images || []) as { title: string }[];
			return images.map((i) => i.title).join("、");
		},
	},
	{
		key: "gallery",
		file: "src/config/data/gallery.json",
		title: "相册",
		summary: (data) => {
			const albums = (data.albums || []) as { name: string }[];
			return albums.map((a) => a.name).join("、");
		},
	},
	{
		key: "friends",
		file: "src/config/data/friends.json",
		title: "友链",
		summary: (data) => {
			const friends = (data.friends || []) as { title: string }[];
			return friends.map((f) => f.title).join("、");
		},
	},
	{
		key: "sponsor",
		file: "src/config/data/sponsor.json",
		title: "打赏",
		summary: (data) => {
			const methods = (data.methods || []) as { name: string; enabled: boolean }[];
			return methods
				.filter((m) => m.enabled)
				.map((m) => m.name)
				.join("、");
		},
	},
	{
		key: "adminWhitelist",
		file: "src/config/data/admin-whitelist.json",
		title: "管理账号白名单",
		summary: (data) => {
			if (data.enabled !== true) return "未开启";
			const admins = (data.admins || []) as string[];
			return `已开启: ${admins.join("、")}`;
		},
	},
];

function loadData(entry: ConfigEntry): Record<string, unknown> {
	return JSON.parse(
		readFileSync(resolve(root, entry.file), "utf8"),
	) as Record<string, unknown>;
}

function saveData(entry: ConfigEntry, data: Record<string, unknown>): void {
	writeFileSync(
		resolve(root, entry.file),
		`${JSON.stringify(data, null, 2)}\n`,
		"utf8",
	);
	console.log(`已保存 ${entry.file}`);
	try {
		execSync("npx tsx scripts/validate-config-json.ts", {
			cwd: root,
			stdio: "inherit",
		});
	} catch {
		console.warn("配置已写入，但 JSON 校验未通过，请检查刚才的改动。");
	}
}

async function ask(question: string): Promise<string> {
	const answer = await rl.question(question);
	return answer.trim();
}

async function confirm(question: string): Promise<boolean> {
	const answer = await ask(`${question}（y/n）`);
	return ["y", "yes", "是", "1"].includes(answer.toLowerCase());
}

async function promptField(
	field: Field,
	current: unknown,
): Promise<unknown> {
	const currentText = current === undefined || current === "" ? "" : `（当前: ${String(current)}）`;
	const answer = await ask(`${field.required ? `${field.label}*` : field.label} ${currentText}: `);

	if (answer === "" && current !== undefined) return current;
	if (answer === "" && field.required) {
		console.log("必填字段不能为空，请重新输入。");
		return promptField(field, current);
	}
	if (answer === "" && !field.required) {
		if (field.type === "tags") return [];
		return undefined;
	}

	switch (field.type) {
		case "number": {
			const value = Number(answer);
			return Number.isFinite(value) ? value : current;
		}
		case "boolean":
			return ["true", "y", "yes", "1", "是"].includes(answer.toLowerCase());
		case "tags":
			return answer
				.split(/[,，]/)
				.map((item) => item.trim())
				.filter(Boolean);
		default:
			return answer;
	}
}

async function promptItem(
	fields: Field[],
	current: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
	const item: Record<string, unknown> = current ? { ...current } : {};
	for (const field of fields) {
		item[field.key] = await promptField(field, item[field.key]);
	}
	return item;
}

function listItems(
	items: Record<string, unknown>[],
	label: (item: Record<string, unknown>) => string,
): void {
	items.forEach((item, index) => {
		const id = item.id ? ` [${String(item.id)}]` : "";
		console.log(`${index + 1}. ${label(item)}${id}`);
	});
}

async function pickItem<T>(items: T[], action: string): Promise<number | null> {
	if (items.length === 0) {
		console.log("当前没有可操作的项目。");
		return null;
	}
	const answer = await ask(`选择要${action}的编号（0 返回）: `);
	const index = Number(answer) - 1;
	if (answer === "0") return null;
	if (!Number.isInteger(index) || index < 0 || index >= items.length) {
		console.log("编号无效。");
		return pickItem(items, action);
	}
	return index;
}

async function editArray(
	items: Record<string, unknown>[],
	fields: Field[],
	label: (item: Record<string, unknown>) => string,
	onSave: () => void,
): Promise<void> {
	while (true) {
		if (items.length === 0) {
			console.log("（空）");
		} else {
			listItems(items, label);
		}
		console.log("a. 新增  e. 编辑  d. 删除  q. 返回");
		const action = await ask("操作: ");

		if (action === "q") return;
		if (action === "a") {
			items.push(await promptItem(fields, null));
		} else if (action === "e") {
			const index = await pickItem(items, "编辑");
			if (index === null) continue;
			items[index] = await promptItem(fields, items[index]);
		} else if (action === "d") {
			const index = await pickItem(items, "删除");
			if (index === null) continue;
			if (await confirm(`确定删除“${label(items[index])}”？`)) {
				items.splice(index, 1);
			}
		} else {
			console.log("无效操作。");
			continue;
		}

		onSave();
	}
}

async function editBooknav(): Promise<void> {
	const entry = configs.find((c) => c.key === "booknav")!;
	const data = loadData(entry);
	const groups = (data.groups || []) as Record<string, unknown>[];
	const groupFields: Field[] = [
		{ key: "id", label: "分类 ID（锚点，如 dev）", required: true },
		{ key: "name", label: "分类名称", required: true },
		{ key: "icon", label: "图标（Iconify 名）" },
		{ key: "desc", label: "描述" },
		{ key: "weight", label: "权重", type: "number" },
		{ key: "enabled", label: "启用", type: "boolean" },
	];
	const itemFields: Field[] = [
		{ key: "title", label: "网站名称", required: true },
		{ key: "url", label: "网址", required: true },
		{ key: "desc", label: "描述" },
		{ key: "icon", label: "图标（可留空自动取 favicon）" },
		{ key: "weight", label: "权重", type: "number" },
		{ key: "enabled", label: "启用", type: "boolean" },
	];

	while (true) {
		console.log("\n网站导航分类：");
		if (groups.length === 0) {
			console.log("（空）");
		} else {
			listItems(groups, (g) => String(g.name || g.id || "未命名"));
		}
		console.log("a. 新增分类  e. 编辑分类  d. 删除分类  s. 管理分类下的网站  q. 返回");
		const action = await ask("操作: ");

		if (action === "q") return;
		if (action === "a") {
			groups.push(await promptItem(groupFields, null));
		} else if (action === "e") {
			const index = await pickItem(groups, "编辑");
			if (index === null) continue;
			groups[index] = await promptItem(groupFields, groups[index]);
		} else if (action === "d") {
			const index = await pickItem(groups, "删除");
			if (index === null) continue;
			if (await confirm(`确定删除分类“${String(groups[index].name || groups[index].id)}”？`)) {
				groups.splice(index, 1);
			}
		} else if (action === "s") {
			const index = await pickItem(groups, "管理");
			if (index === null) continue;
			const group = groups[index];
			const items = (group.items || []) as Record<string, unknown>[];
			await editArray(
				items,
				itemFields,
				(item) => String(item.title || item.url || "未命名"),
				() => {
					group.items = items;
					data.groups = groups;
					saveData(entry, data);
				},
			);
		} else {
			console.log("无效操作。");
			continue;
		}

		data.groups = groups;
		saveData(entry, data);
	}
}

async function editImgbed(): Promise<void> {
	const entry = configs.find((c) => c.key === "imgbed")!;
	const data = loadData(entry);
	const fields: Field[] = [
		{ key: "id", label: "素材 ID（唯一）", required: true },
		{ key: "title", label: "标题", required: true },
		{ key: "src", label: "资源地址", required: true },
		{ key: "type", label: "类型（image/video，留空为图片）" },
		{ key: "category", label: "分类", required: true },
		{ key: "tags", label: "标签（逗号分隔）", type: "tags" },
	];
	await editArray(
		(data.images || []) as Record<string, unknown>[],
		fields,
		(item) => String(item.title || item.id || "未命名"),
		() => saveData(entry, data),
	);
}

async function showList(): Promise<void> {
	for (const entry of configs) {
		const data = loadData(entry);
		console.log(`${entry.title}: ${entry.summary(data) || "（空）"}`);
	}
}

function getToday(): string {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, "0");
	const day = String(today.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function splitTags(text: string): string[] {
	return text
		.split(/[,，]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function toSlug(text: string): string {
	return text
		.split("/")
		.map((segment) => {
			if (!/[一-鿿]/.test(segment)) return segment;
			const chars = [...segment];
			const parts: string[] = [];
			let buffer = "";
			for (const ch of chars) {
				if (/[一-鿿]/.test(ch)) {
					if (buffer) {
						parts.push(buffer);
						buffer = "";
					}
					parts.push(pinyin(ch, { toneType: "none", type: "array" })[0]);
				} else {
					buffer += ch;
				}
			}
			if (buffer) parts.push(buffer);
			return parts
				.join("-")
				.toLowerCase()
				.replace(/[^a-z0-9-]/g, "")
				.replace(/-+/g, "-")
				.replace(/^-|-$/g, "");
		})
		.join("/");
}

async function createPostFile(options: {
	title: string;
	category: string;
	tagsText: string;
	description: string;
	draft?: boolean;
}): Promise<void> {
	const { title, category, tagsText, description, draft = false } = options;
	const slug = toSlug(title);
	const fileName = `${slug}.md`;
	const fullPath = resolve(root, "src/content/posts", fileName);
	if (existsSync(fullPath)) {
		console.error(`文件已存在：${fullPath}`);
		return;
	}

	const tags = splitTags(tagsText);
	const tagsTextContent = tags.length > 0 ? tags.map((tag) => `"${tag}"`).join(", ") : "";
	const content = `---
title: ${title}
published: ${getToday()}
description: ${description ? `"${description}"` : "''"}
image: ''
tags: [${tagsTextContent}]
category: ${category ? `"${category}"` : "''"}
draft: ${draft}
lang: ''
slug: ${slug}
---

在这里写正文...
`;

	mkdirSync(dirname(fullPath), { recursive: true });
	writeFileSync(fullPath, content, "utf8");
	console.log(`文章已创建：${fullPath}`);
}

async function createPostInteractive(): Promise<void> {
	const title = await ask("文章标题*: ");
	if (!title) {
		console.log("标题必填，已取消。");
		return;
	}
	const category = await ask("分类（可留空）: ");
	const tagsText = await ask("标签（逗号分隔，可留空）: ");
	const description = await ask("描述（可留空）: ");
	await createPostFile({ title, category, tagsText, description });
}

async function createDynamicFile(options: {
	content: string;
	location: string;
}): Promise<void> {
	const { content, location } = options;
	const now = new Date();
	const timezone = siteConfig.timezone || "Asia/Shanghai";
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	})
		.formatToParts(now)
		.reduce<Record<string, string>>((result, part) => {
			if (part.type !== "literal") result[part.type] = part.value;
			return result;
		}, {});
	const timestamp = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
	const fileName = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}.md`;
	const fullPath = resolve(root, "src/content/dynamic", fileName);

	mkdirSync(dirname(fullPath), { recursive: true });
	writeFileSync(
		fullPath,
		`---
published: ${timestamp}
location: ${location}
---

${content}
`,
		"utf8",
	);
	console.log(`动态已创建：${fullPath}`);
}

async function createDynamicInteractive(): Promise<void> {
	const content = await ask("动态内容*: ");
	if (!content) {
		console.log("动态内容必填，已取消。");
		return;
	}
	const location = (await ask("定位（默认湖南）: ")) || "湖南";
	await createDynamicFile({ content, location });
}

async function commitAndPush(message?: string): Promise<void> {
	const commitMessage =
		message || (await ask("提交信息（可留空，默认: chore: 站点内容更新）: ")) ||
		"chore: 站点内容更新";

	console.log("正在运行 pnpm check ...");
	try {
		execSync("pnpm check", { cwd: root, stdio: "inherit" });
	} catch {
		console.error("pnpm check 未通过，已中止提交推送。");
		return;
	}

	try {
		execFileSync("git", ["add", "-A"], { cwd: root, stdio: "inherit" });
		execFileSync("git", ["commit", "-m", commitMessage], {
			cwd: root,
			stdio: "inherit",
		});
		execFileSync("git", ["push", "origin", "master"], {
			cwd: root,
			stdio: "inherit",
		});
		console.log("提交并推送成功。");
	} catch (error) {
		console.error("提交或推送失败：", error instanceof Error ? error.message : error);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.includes("--list")) {
		await showList();
		rl.close();
		return;
	}

	const getArgValue = (name: string): string | undefined => {
		const index = args.indexOf(name);
		return index >= 0 ? args[index + 1] : undefined;
	};

	const newPostTitle = getArgValue("--new-post");
	if (newPostTitle) {
		await createPostFile({
			title: newPostTitle,
			category: getArgValue("--category") || "",
			tagsText: getArgValue("--tags") || "",
			description: getArgValue("--description") || "",
			draft: args.includes("--draft"),
		});
		rl.close();
		return;
	}

	const newDynamicContent = getArgValue("--new-dynamic");
	if (newDynamicContent) {
		await createDynamicFile({
			content: newDynamicContent,
			location: getArgValue("--location") || "湖南",
		});
		rl.close();
		return;
	}

	if (args.includes("--push")) {
		await commitAndPush(getArgValue("--push") || undefined);
		rl.close();
		return;
	}

	console.log("沐风本地工作台 v0.2");

	while (true) {
		console.log("\n1. 配置编辑器  2. 新建文章  3. 新建动态  4. 提交推送  q. 退出");
		const choice = await ask("选择: ");
		if (choice === "q") break;
		if (choice === "1") {
			console.log("\n1. 网站导航  2. 图床");
			const target = await ask("选择: ");
			if (target === "1") await editBooknav();
			if (target === "2") await editImgbed();
		}
		if (choice === "2") await createPostInteractive();
		if (choice === "3") await createDynamicInteractive();
		if (choice === "4") await commitAndPush();
	}

	rl.close();
}

main().catch((error) => {
	console.error(error);
	rl.close();
	process.exit(1);
});
