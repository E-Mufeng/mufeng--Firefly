/**
 * mufeng R2 public proxy
 *
 * 安全边界：
 * - 禁止公开 R2 桶，所有访问必须经过本 Worker。
 * - 不使用通配符 CORS，只允许 env.ALLOWED_ORIGINS 中的来源。
 * - Referer 防盗链由 env.ALLOWED_REFERERS 控制。
 * - 密钥不进入 Worker 源码，R2 通过 Cloudflare binding 访问。
 */

const DEFAULT_CACHE_CONTROL = "public, max-age=86400";

const MIME_TYPES = {
	".avif": "image/avif",
	".bmp": "image/bmp",
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".pdf": "application/pdf",
	".txt": "text/plain; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
	".json": "application/json",
	".wasm": "application/wasm",
};

const TANG_API = "https://tang.api.s01s.cn/music_open_api.php";

function jsonResponse(status, message) {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

function splitList(value) {
	return (value || "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function withMusicCors(headers, request, env) {
	const cors = corsHeaders(request, env);
	if (cors) {
		for (const [name, value] of cors.entries()) {
			headers.set(name, value);
		}
	}
	return headers;
}

function corsHeaders(request, env) {
	const origin = request.headers.get("Origin");
	const allowedOrigins = splitList(env.ALLOWED_ORIGINS);
	if (!origin || !allowedOrigins.includes(origin)) {
		return null;
	}
	const headers = new Headers();
	headers.set("Access-Control-Allow-Origin", origin);
	headers.set("Vary", "Origin");
	headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
	headers.set("Access-Control-Allow-Headers", "Range, Content-Type");
	headers.set(
		"Access-Control-Expose-Headers",
		"ETag, Content-Length, Accept-Ranges, Content-Range, Cache-Control",
	);
	headers.set("Access-Control-Max-Age", "3600");
	return headers;
}

function isAllowedReferer(request, env) {
	const referer = request.headers.get("Referer");
	if (!referer) {
		return env.REQUIRE_REFERER !== "true";
	}
	try {
		const host = new URL(referer).hostname.toLowerCase();
		const allowed = splitList(env.ALLOWED_REFERERS);
		return allowed.some(
			(domain) => host === domain || host.endsWith("." + domain),
		);
	} catch {
		return false;
	}
}

/**
 * 解析 HTTP Range，兼容 bytes=start-end、bytes=start-、bytes=-suffix。
 */
function parseRange(header) {
	if (!header || !header.startsWith("bytes=")) {
		return null;
	}
	const value = header.slice(6).split("-", 2);
	const start = value[0] || "";
	const end = value[1] || "";
	if (!start && !end) {
		return null;
	}
	if (!start && end) {
		const suffix = Number(end);
		return Number.isFinite(suffix) && suffix > 0 ? { suffix } : null;
	}
	const offset = Number(start);
	if (!Number.isFinite(offset)) {
		return null;
	}
	if (!end) {
		return { offset };
	}
	const endOffset = Number(end);
	if (!Number.isFinite(endOffset) || endOffset < offset) {
		return null;
	}
	return { offset, length: endOffset - offset + 1 };
}

async function fetchTang(params) {
	const query = new URLSearchParams(params).toString();
	const res = await fetch(`${TANG_API}?${query}`, {
		headers: { "User-Agent": "Mozilla/5.0" },
	});
	if (!res.ok) {
		return null;
	}
	return await res.json();
}

function normalizeText(value) {
	return String(value || "").trim().toLowerCase();
}

function pickTangSong(list, title, artist) {
	if (!Array.isArray(list) || list.length === 0) {
		return null;
	}
	const targetTitle = normalizeText(title);
	const targetArtist = normalizeText(artist);
	let titleMatch = null;
	let fuzzyMatch = null;
	for (const item of list) {
		const itemTitle = normalizeText(item.song_title || item.song_name);
		const itemArtist = normalizeText(item.singer_name);
		if (
			itemTitle === targetTitle &&
			(!targetArtist || itemArtist === targetArtist)
		) {
			return item;
		}
		if (!titleMatch && itemTitle === targetTitle) {
			titleMatch = item;
		}
		if (
			!fuzzyMatch &&
			(!targetArtist || itemArtist === targetArtist) &&
			(itemTitle.includes(targetTitle) || targetTitle.includes(itemTitle))
		) {
			fuzzyMatch = item;
		}
	}
	return titleMatch || fuzzyMatch || list[0];
}

async function resolveTangDetail(title, artist) {
	if (!title) {
		return null;
	}
	const list = await fetchTang({ msg: title, type: "json" });
	const song = pickTangSong(list, title, artist);
	if (!song) {
		return null;
	}
	return await fetchTang({
		msg: song.song_title || song.song_name || title,
		type: "json",
		mid: song.song_mid,
	});
}

function pickPlayUrl(detail) {
	if (!detail) {
		return "";
	}
	const candidates = [
		"song_play_url_hq",
		"song_play_url",
		"song_play_url_standard",
		"song_play_url_sq",
		"song_play_url_fq",
	];
	for (const key of candidates) {
		const value = detail[key];
		if (typeof value === "string" && value.startsWith("http")) {
			return value.replace(/^http:\/\//i, "https://");
		}
	}
	return "";
}

async function fetchMetingPlaylist(server, type, id) {
	const apis = [
		`https://api.i-meto.com/meting/api?server=${encodeURIComponent(server)}&type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}&r=${Math.random()}`,
		`https://api.injahow.cn/meting/?server=${encodeURIComponent(server)}&type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`,
		`https://api.moeyao.cn/meting/?server=${encodeURIComponent(server)}&type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`,
	];
	for (const api of apis) {
		try {
			const res = await fetch(api, {
				headers: {
					"User-Agent": "Mozilla/5.0",
					Referer: "https://music.163.com/",
				},
			});
			if (!res.ok) {
				continue;
			}
			const data = JSON.parse(await res.text());
			if (Array.isArray(data) && data.length > 0) {
				return data;
			}
		} catch {
			// try next playlist API
		}
	}
	return null;
}

async function handleMusicRequest(request, env, url) {
	const path = url.pathname;
	const origin = url.origin;

	if (path === "/music/playlist") {
		const server = url.searchParams.get("server") || "tencent";
		const type = url.searchParams.get("type") || "playlist";
		const id = url.searchParams.get("id") || "";
		if (!id) {
			return jsonResponse(400, "Missing playlist id");
		}
		const data = await fetchMetingPlaylist(server, type, id);
		if (!data) {
			return jsonResponse(502, "Music playlist API failed");
		}
		const playlist = data.map((item) => {
			const title = item.title || item.name || "未知歌曲";
			const artist = item.author || item.artist || "未知歌手";
			const sourcePic = item.pic || item.cover || "";
			const query = new URLSearchParams({
				title,
				artist,
			}).toString();
			return {
				title,
				author: artist,
				url: `${origin}/music/stream?${query}`,
				pic: sourcePic
					? `${origin}/music/pic?src=${encodeURIComponent(sourcePic)}`
					: "",
				lrc: `${origin}/music/lrc?${query}`,
			};
		});
		const headers = new Headers({
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		});
		withMusicCors(headers, request, env);
		return new Response(JSON.stringify(playlist), { status: 200, headers });
	}

	if (path === "/music/pic") {
		const src = url.searchParams.get("src") || "";
		if (!/^https?:\/\//i.test(src)) {
			return jsonResponse(400, "Invalid image src");
		}
		try {
			const res = await fetch(src, {
				headers: {
					"User-Agent": "Mozilla/5.0",
					Referer: "https://music.163.com/",
				},
			});
			if (!res.ok) {
				return jsonResponse(502, "Image fetch failed");
			}
			const headers = new Headers();
			headers.set(
				"Content-Type",
				res.headers.get("Content-Type") || "image/jpeg",
			);
			headers.set("Cache-Control", "public, max-age=86400");
			headers.set("X-Content-Type-Options", "nosniff");
			withMusicCors(headers, request, env);
			return new Response(res.body, { status: 200, headers });
		} catch {
			return jsonResponse(502, "Image fetch failed");
		}
	}

	if (path === "/music/stream") {
		const title = url.searchParams.get("title") || "";
		const artist = url.searchParams.get("artist") || "";
		const detail = await resolveTangDetail(title, artist);
		const playUrl = pickPlayUrl(detail);
		if (!playUrl) {
			return jsonResponse(404, "Music not found");
		}
		const headers = new Headers({
			Location: playUrl,
			"Cache-Control": "no-store",
		});
		withMusicCors(headers, request, env);
		return new Response(null, { status: 302, headers });
	}

	if (path === "/music/lrc") {
		const title = url.searchParams.get("title") || "";
		const artist = url.searchParams.get("artist") || "";
		const detail = await resolveTangDetail(title, artist);
		const lrc = detail?.song_lyric || detail?.lyric || "";
		if (!lrc) {
			return jsonResponse(404, "Lyrics not found");
		}
		const headers = new Headers({
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "no-store",
		});
		withMusicCors(headers, request, env);
		return new Response(lrc, { status: 200, headers });
	}

	return jsonResponse(404, "Music endpoint not found");
}

function mimeType(key) {
	const lower = key.toLowerCase();
	const dot = lower.lastIndexOf(".");
	if (dot < 0) {
		return "application/octet-stream";
	}
	return MIME_TYPES[lower.slice(dot)] || "application/octet-stream";
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.protocol === "http:" && env.FORCE_HTTPS === "true") {
			url.protocol = "https:";
			return Response.redirect(url.toString(), 301);
		}

		const cors = corsHeaders(request, env);
		if (request.method === "OPTIONS") {
			if (!cors) {
				return jsonResponse(403, "CORS origin not allowed");
			}
			return new Response(null, { status: 204, headers: cors });
		}

		if (request.method !== "GET" && request.method !== "HEAD") {
			return jsonResponse(405, "Method not allowed");
		}

		if (!isAllowedReferer(request, env)) {
			return jsonResponse(403, "Referer not allowed");
		}

		if (url.pathname.startsWith("/music/")) {
			return await handleMusicRequest(request, env, url);
		}

		const key = decodeURIComponent(url.pathname).replace(/^\/+/, "");
		if (!key) {
			return jsonResponse(400, "Empty object key");
		}

		const range = parseRange(request.headers.get("Range"));

		// 边缘缓存：仅缓存无 Range 的 GET 请求；不可用或异常时直接回退到 R2 读取
		const cacheKey =
			request.method === "GET" && !range
				? new Request(url.toString(), {
						method: "GET",
						headers: { Accept: request.headers.get("Accept") || "*/*" },
					})
				: null;

		if (cacheKey && typeof caches !== "undefined") {
			try {
				const cachedResponse = await caches.default.match(cacheKey);
				if (cachedResponse) {
					const cachedHeaders = new Headers(cachedResponse.headers);
					cachedHeaders.set(
						"Cache-Control",
						env.CACHE_CONTROL || DEFAULT_CACHE_CONTROL,
					);
					if (cors) {
						for (const [name, value] of cors.entries()) {
							cachedHeaders.set(name, value);
						}
					}
					return new Response(cachedResponse.body, {
						status: cachedResponse.status,
						headers: cachedHeaders,
					});
				}
			} catch {
				// 缓存不可用时继续走 R2 读取
			}
		}

		let object;
		try {
			object = await env.R2_BUCKET.get(
				key,
				range ? { range } : undefined,
			);
		} catch (error) {
			return jsonResponse(502, "R2 read failed");
		}

		if (!object) {
			return jsonResponse(404, "Object not found");
		}

		const headers = new Headers();
		headers.set("Content-Type", object.httpMetadata?.contentType || mimeType(key));
		headers.set("Cache-Control", env.CACHE_CONTROL || DEFAULT_CACHE_CONTROL);
		headers.set("ETag", object.httpEtag || object.etag || "");
		headers.set("Accept-Ranges", "bytes");
		headers.set("X-Content-Type-Options", "nosniff");

		const isRangeResponse = Boolean(range && object.range);
		const rangeStart = isRangeResponse ? (object.range.offset ?? 0) : 0;
		const rangeLength = isRangeResponse
			? object.range.length ?? object.size
			: object.size;
		headers.set("Content-Length", String(rangeLength));

		if (isRangeResponse) {
			const end = rangeStart + rangeLength - 1;
			headers.set("Content-Range", `bytes ${rangeStart}-${end}/${object.size}`);
		}

		if (cors) {
			for (const [name, value] of cors.entries()) {
				headers.set(name, value);
			}
		}

		const body = request.method === "HEAD" ? null : object.body;
		const response = new Response(body, {
			status: isRangeResponse ? 206 : 200,
			headers,
		});

		if (cacheKey && response.ok && typeof caches !== "undefined") {
			try {
				const clone = response.clone();
				ctx.waitUntil(caches.default.put(cacheKey, clone));
			} catch {
				// 写缓存失败不影响本次响应
			}
		}

		return response;
	},
};
