/**
 * 校验 src/config/data 下的 JSON 配置是否符合对应 schema。
 * 用法：pnpm check:config 或 pnpm check（会自动先执行本脚本）。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type JsonSchema = {
	type?: string;
	required?: string[];
	properties?: Record<string, JsonSchema>;
	additionalProperties?: boolean;
	items?: JsonSchema;
	enum?: unknown[];
};

const configs: { data: string; schema: string }[] = [
	{
		data: "src/config/data/navbar.json",
		schema: "src/config/data/schemas/navbar.schema.json",
	},
	{
		data: "src/config/data/booknav.json",
		schema: "src/config/data/schemas/booknav.schema.json",
	},
	{
		data: "src/config/data/imgbed.json",
		schema: "src/config/data/schemas/imgbed.schema.json",
	},
	{
		data: "src/config/data/gallery.json",
		schema: "src/config/data/schemas/gallery.schema.json",
	},
	{
		data: "src/config/data/friends.json",
		schema: "src/config/data/schemas/friends.schema.json",
	},
	{
		data: "src/config/data/sponsor.json",
		schema: "src/config/data/schemas/sponsor.schema.json",
	},
	{
		data: "src/config/data/admin-whitelist.json",
		schema: "src/config/data/schemas/admin-whitelist.schema.json",
	},
];

function validate(value: unknown, schema: JsonSchema | undefined, path: string, errors: string[]) {
	if (!schema) return;

	if (schema.enum && !schema.enum.includes(value)) {
		errors.push(`${path}: 不在允许的值范围内`);
		return;
	}

	if (schema.type === "array") {
		if (!Array.isArray(value)) {
			errors.push(`${path}: 应为数组`);
			return;
		}
		value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`, errors));
		return;
	}

	if (schema.type === "object") {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			errors.push(`${path}: 应为对象`);
			return;
		}
		const record = value as Record<string, unknown>;
		for (const key of schema.required || []) {
			if (!(key in record)) {
				errors.push(`${path}.${key}: 缺少必填字段`);
			}
		}
		for (const [key, child] of Object.entries(schema.properties || {})) {
			if (key in record) {
				validate(record[key], child, `${path}.${key}`, errors);
			}
		}
		if (schema.additionalProperties === false) {
			for (const key of Object.keys(record)) {
				if (!schema.properties || !(key in schema.properties)) {
					errors.push(`${path}.${key}: 不允许的额外字段`);
				}
			}
		}
		return;
	}

	if (schema.type === "string" && typeof value !== "string") {
		errors.push(`${path}: 应为字符串`);
	}
	if (schema.type === "number" && typeof value !== "number") {
		errors.push(`${path}: 应为数字`);
	}
	if (schema.type === "boolean" && typeof value !== "boolean") {
		errors.push(`${path}: 应为布尔值`);
	}
}

let failed = false;

for (const { data, schema } of configs) {
	const dataPath = resolve(root, data);
	const schemaPath = resolve(root, schema);
	const errors: string[] = [];

	try {
		const dataValue = JSON.parse(readFileSync(dataPath, "utf8"));
		const schemaValue = JSON.parse(readFileSync(schemaPath, "utf8")) as JsonSchema;
		validate(dataValue, schemaValue, data, errors);
	} catch (error) {
		errors.push(`读取或解析失败: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (errors.length > 0) {
		failed = true;
		console.error(`✗ ${data}`);
		for (const error of errors) {
			console.error(`  - ${error}`);
		}
	} else {
		console.log(`✓ ${data}`);
	}
}

if (failed) {
	console.error("配置 JSON 校验未通过。");
	process.exit(1);
}

console.log(`配置 JSON 校验通过，共 ${configs.length} 份。`);
