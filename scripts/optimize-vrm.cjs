/**
 * .vrm-opt.cjs — 把 GLB/VRM 里的 PNG 贴图就地转成 WebP，显著缩小体积。
 *
 * 只动「被 image 引用的 bufferView」，其余二进制原样搬运，几何/骨骼/morph/VRM 扩展
 * 一律不碰 —— 这是最小侵入的做法，避免通用 glTF 优化器误删 springBone 节点。
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const QUALITY = 85;
const MAX_SIZE = 2048;

function parseGlb(buf) {
	const magic = buf.readUInt32LE(0);
	if (magic !== 0x46546c67) throw new Error("not a glb");
	const total = buf.readUInt32LE(8);
	let off = 12;
	let json = null;
	let bin = null;
	while (off < total) {
		const len = buf.readUInt32LE(off);
		const type = buf.readUInt32LE(off + 4);
		const data = buf.slice(off + 8, off + 8 + len);
		if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
		else if (type === 0x004e4942) bin = data;
		off += 8 + len;
	}
	if (!json) throw new Error("no JSON chunk");
	return { json, bin };
}

function buildGlb(json, bin) {
	let jsonStr = JSON.stringify(json);
	// JSON chunk 必须 4 字节对齐，用空格补齐
	while (jsonStr.length % 4 !== 0) jsonStr += " ";
	const jsonBuf = Buffer.from(jsonStr, "utf8");

	let binPadded = bin;
	while (binPadded.length % 4 !== 0) binPadded = Buffer.concat([binPadded, Buffer.alloc(1)]);

	const total = 12 + 8 + jsonBuf.length + 8 + binPadded.length;
	const out = Buffer.alloc(total);
	out.writeUInt32LE(0x46546c67, 0);
	out.writeUInt32LE(2, 4);
	out.writeUInt32LE(total, 8);
	out.writeUInt32LE(jsonBuf.length, 12);
	out.writeUInt32LE(0x4e4f534a, 16);
	jsonBuf.copy(out, 20);
	const binHdr = 20 + jsonBuf.length;
	out.writeUInt32LE(binPadded.length, binHdr);
	out.writeUInt32LE(0x004e4942, binHdr + 4);
	binPadded.copy(out, binHdr + 8);
	return out;
}

async function optimize(file) {
	const buf = fs.readFileSync(file);
	const { json, bin } = parseGlb(buf);
	const images = json.images || [];
	if (!images.length) {
		console.log("  no images, skip");
		return;
	}

	// 找出被 image 引用的 bufferView，以及被 accessor 引用的 bufferView（后者绝不能改内容）
	const imageBv = new Map(); // bufferView index -> image index
	images.forEach((im, i) => {
		if (im.bufferView != null) imageBv.set(im.bufferView, i);
	});
	const accessorBv = new Set();
	(json.accessors || []).forEach((a) => {
		if (a.bufferView != null) accessorBv.add(a.bufferView);
	});
	for (const bv of imageBv.keys()) {
		if (accessorBv.has(bv)) throw new Error("image bufferView 同时被 accessor 使用，放弃");
	}

	const bvs = json.bufferViews || [];
	let savedBytes = 0;
	let converted = 0;
	const chunks = [];

	// 按 bufferView 顺序重建 BIN，保证 byteOffset 单调递增
	const order = bvs.map((_, i) => i).sort((a, b) => (bvs[a].byteOffset || 0) - (bvs[b].byteOffset || 0));
	// 上面是倒序（从大到小）；我们按原始 offset 升序处理
	order.reverse();

	let cursor = 0;
	for (const i of order) {
		const bv = bvs[i];
		const start = bv.byteOffset || 0;
		let data = bin.slice(start, start + bv.byteLength);

		if (imageBv.has(i)) {
			const im = images[imageBv.get(i)];
			try {
				let pipe = sharp(data, { failOn: "none" });
				const meta = await pipe.metadata();
				const w = meta.width || 0;
				const h = meta.height || 0;
				if (Math.max(w, h) > MAX_SIZE) {
					pipe = pipe.resize(MAX_SIZE, MAX_SIZE, { fit: "inside", withoutEnlargement: true });
				}
				const webp = await pipe.webp({ quality: QUALITY, effort: 4 }).toBuffer();
				if (webp.length < data.length) {
					savedBytes += data.length - webp.length;
					data = webp;
					im.mimeType = "image/webp";
					converted++;
				}
			} catch (e) {
				console.log("  img", imageBv.get(i), "转换失败，保留原图:", e.message.slice(0, 60));
			}
		}

		// 4 字节对齐
		const pad = (4 - (cursor % 4)) % 4;
		if (pad) {
			chunks.push(Buffer.alloc(pad));
			cursor += pad;
		}
		bv.byteOffset = cursor;
		bv.byteLength = data.length;
		chunks.push(data);
		cursor += data.length;
	}

	const newBin = Buffer.concat(chunks);
	// 保留原 buffer 定义（GLB 的 buffer 无 uri），只更新长度
	json.buffers = json.buffers && json.buffers.length ? json.buffers : [{}];
	json.buffers[0].byteLength = newBin.length;
	const out = buildGlb(json, newBin);

	const before = buf.length;
	const after = out.length;
	console.log(
		`  ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB  ` +
			`(转换 ${converted} 张贴图, 省 ${(savedBytes / 1048576).toFixed(1)}MB)`,
	);
	fs.writeFileSync(file, out);
}

(async () => {
	const dir = "public/models/vrm";
	for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".vrm"))) {
		const p = path.join(dir, f);
		console.log("---", f);
		await optimize(p);
	}
})().catch((e) => {
	console.error("FAILED:", e);
	process.exit(1);
});
