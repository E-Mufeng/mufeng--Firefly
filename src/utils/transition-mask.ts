/**
 * transition-mask.ts — 电影感页面切换遮罩
 *
 * 与 Swup 的内容淡入淡出解耦：遮罩自身不带 transition- 前缀，
 * Swup 不会 await 它，完全由 visit:start（覆盖）/ page:view（揭开）两钩子
 * 用独立 CSS 动画驱动。默认隐藏、pointer-events:none，不挡首屏。
 */
export function initTransitionMask(): void {
	if (window.__fireflyTransitionMask) return;
	window.__fireflyTransitionMask = true;

	const mask = document.getElementById("page-transition-mask");
	if (!mask) return;

	const cover = (): void => {
		mask.classList.remove("is-revealing");
		void mask.offsetWidth; // 强制回流，确保动画从头播放
		mask.classList.add("is-covering");
	};

	const reveal = (): void => {
		mask.classList.remove("is-covering");
		void mask.offsetWidth;
		mask.classList.add("is-revealing");
		const done = (): void => mask.classList.remove("is-revealing");
		mask.addEventListener("animationend", done, { once: true });
		// 兜底：若 animationend 未触发（reduced-motion 等）也清场
		window.setTimeout(done, 900);
	};

	const register = (): void => {
		window.swup.hooks.on("visit:start", cover);
		window.swup.hooks.on("page:view", reveal);
	};

	if (window?.swup?.hooks) register();
	else document.addEventListener("swup:enable", register, { once: true });
}
