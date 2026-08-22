import type { FriendLink, FriendsPageConfig } from "../types/friendsConfig";
import friendsData from "./data/friends.json";

// 友链配置：数据统一存放在 src/config/data/friends.json
export const friendsPageConfig: FriendsPageConfig = friendsData.pageConfig;

export const friendsConfig: FriendLink[] = friendsData.friends;

// 获取启用的友链并进行排序
export const getEnabledFriends = (): FriendLink[] => {
	const friends = friendsConfig.filter((friend) => friend.enabled);

	if (friendsPageConfig.randomizeSort) {
		return friends.sort(() => Math.random() - 0.5);
	}

	return friends.sort((a, b) => b.weight - a.weight);
};
