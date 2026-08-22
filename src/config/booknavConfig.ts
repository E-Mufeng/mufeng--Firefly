import type { BooknavGroup, BooknavPageConfig } from "../types/booknavConfig";
import booknavData from "./data/booknav.json";

// 网站导航配置：数据统一存放在 src/config/data/booknav.json
export const booknavPageConfig: BooknavPageConfig = booknavData.pageConfig;

export const booknavConfig: BooknavGroup[] = booknavData.groups;
