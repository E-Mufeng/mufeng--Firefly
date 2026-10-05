import type { SoundEffectsConfig } from "../types/effectsConfig";

// Web Audio 程序化音效配置（默认关，由 RightDock 音效按钮或设置开启）
export const soundEffectsConfig: SoundEffectsConfig = {
	// 总开关：默认关闭，需用户主动开启（浏览器自动播放策略 + 体验考量）
	enable: false,

	// 主音量
	volume: 0.5,

	// 悬停：轻柔高音 blip
	hover: {
		enabled: true,
		freq: 880,
		type: "sine",
		duration: 0.08,
	},

	// 点击：清脆双音感（单振荡器短促）
	click: {
		enabled: true,
		freq: 523.25,
		type: "triangle",
		duration: 0.12,
	},

	// 页面切换：上扫音，营造电影感
	navigate: {
		enabled: true,
		freq: 330,
		type: "sawtooth",
		duration: 0.35,
	},
};
