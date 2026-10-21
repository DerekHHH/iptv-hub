/**
 * @file 频道名归一规则表（配置驱动，改这里即可扩展，无需改代码）。
 *
 * 归一目标：把一个频道的所有写法（`CCTV1` / `CCTV-1` / `中央1台` / `央视一套`）
 * 收敛成同一个 ASCII slug（`cctv1`）+ 一个标准中文名。
 *
 * 规则优先级：
 *   1. CCTV 编号模式（正则，覆盖 `CCTV-1`、`中央一台`、`CCTV5+` 等无限写法）
 *   2. 静态别名表（本文件的 `CHANNEL_RULES`）
 *   3. 关键词推断分组 + 名称哈希 slug（保底，绝不丢源）
 */

import type { GroupKey } from '../types';

/** 一条频道归一规则。 */
export interface ChannelRule {
  /** 唯一 slug（ASCII，小写，可带连字符） */
  id: string;
  /** 标准中文名（展示用） */
  name: string;
  /** 固定分组 */
  group: GroupKey;
  /** 命中该规则的原始写法（大小写、空格、标点由归一器忽略） */
  aliases: string[];
  /** 上游 XMLTV 里的 channel id（EPG 匹配用） */
  epgId?: string;
  /** 台标地址（缺失留空） */
  logo?: string;
}

/** 港澳台关键词 → 分组判定用。 */
export const HMT_KEYWORDS: readonly string[] = [
  '香港', '澳门', '台湾', '翡翠', '明珠', 'TVB', '无线', '凤凰', 'VIUTV', 'NOW',
  '中天', '东森', '三立', '民视', '台视', '中视', '华视', '公视', 'TVBS', '澳视',
  '莲花', 'MACAU', 'HONGKONG', 'TAIWAN', 'STAR', 'TVBS', '八大', '非凡', '寰宇',
];

/** 广东地市关键词 → 分组判定用（含 21 个地级市）。 */
export const GUANGDONG_KEYWORDS: readonly string[] = [
  '广东', '广州', '深圳', '珠海', '汕头', '佛山', '韶关', '湛江', '肇庆', '江门',
  '茂名', '惠州', '梅州', '汕尾', '河源', '阳江', '清远', '东莞', '中山', '潮州',
  '揭阳', '云浮', '珠江', '南方', '岭南', '大湾区', '粤',
];

/** 央视关键词。 */
export const CCTV_KEYWORDS: readonly string[] = ['CCTV', '中央', '央视', '中国教育', 'CETV'];

/**
 * 中文数字 → 阿拉伯数字（CCTV 编号用，覆盖 1~17）。
 */
export const CN_NUMERALS: Readonly<Record<string, number>> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  十: 10, 十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16, 十七: 17,
};

/** CCTV 频道表：编号 → 标准名，用于 CCTV 正则归一。 */
export const CCTV_CHANNELS: ReadonlyArray<{ no: number; id: string; name: string }> = [
  { no: 1, id: 'cctv1', name: 'CCTV-1 综合' },
  { no: 2, id: 'cctv2', name: 'CCTV-2 财经' },
  { no: 3, id: 'cctv3', name: 'CCTV-3 综艺' },
  { no: 4, id: 'cctv4', name: 'CCTV-4 中文国际' },
  { no: 5, id: 'cctv5', name: 'CCTV-5 体育' },
  { no: 6, id: 'cctv6', name: 'CCTV-6 电影' },
  { no: 7, id: 'cctv7', name: 'CCTV-7 国防军事' },
  { no: 8, id: 'cctv8', name: 'CCTV-8 电视剧' },
  { no: 9, id: 'cctv9', name: 'CCTV-9 纪录' },
  { no: 10, id: 'cctv10', name: 'CCTV-10 科教' },
  { no: 11, id: 'cctv11', name: 'CCTV-11 戏曲' },
  { no: 12, id: 'cctv12', name: 'CCTV-12 社会与法' },
  { no: 13, id: 'cctv13', name: 'CCTV-13 新闻' },
  { no: 14, id: 'cctv14', name: 'CCTV-14 少儿' },
  { no: 15, id: 'cctv15', name: 'CCTV-15 音乐' },
  { no: 16, id: 'cctv16', name: 'CCTV-16 奥林匹克' },
  { no: 17, id: 'cctv17', name: 'CCTV-17 农业农村' },
];

/** CCTV 特殊频道（非纯编号）。 */
const CCTV_SPECIAL_RULES: ChannelRule[] = [
  {
    id: 'cctv5plus',
    name: 'CCTV-5+ 体育赛事',
    group: '央视',
    epgId: 'CCTV5Plus',
    aliases: ['CCTV5PLUS', 'CCTV5+', 'CCTV-5+', 'CCTV5加', '中央5加', '央视体育赛事', '体育赛事'],
  },
  {
    id: 'cctv4k',
    name: 'CCTV-4K 超高清',
    group: '央视',
    epgId: 'CCTV4K',
    aliases: ['CCTV4K', 'CCTV-4K', 'CCTV4K超高清', '央视4K', 'CCTV8K'],
  },
  {
    id: 'cetv1',
    name: '中国教育一套',
    group: '央视',
    epgId: 'CETV1',
    aliases: ['CETV1', 'CETV-1', '中国教育1台', '中国教育一套'],
  },
  {
    id: 'cetv4',
    name: '中国教育四套',
    group: '央视',
    epgId: 'CETV4',
    aliases: ['CETV4', 'CETV-4', '中国教育4台', '中国教育四套'],
  },
];

/** 港澳台频道规则（优先命中，放在前面）。 */
const HMT_RULES: ChannelRule[] = [
  { id: 'tvb-jade', name: '翡翠台', group: '港澳台', epgId: 'TVBJade', aliases: ['翡翠台', 'TVBJADE', '无线翡翠台', 'TVB翡翠台', 'TVB翡翠', '翡翠', '無綫翡翠台', '無線翡翠台'] },
  { id: 'tvb-pearl', name: '明珠台', group: '港澳台', epgId: 'TVBPearl', aliases: ['明珠台', 'TVBPEARL', '无线明珠台', 'TVB明珠台', '明珠'] },
  { id: 'tvb-news', name: '无线新闻台', group: '港澳台', epgId: 'TVBNews', aliases: ['无线新闻台', 'TVB新闻台', 'TVBN', '无线新闻', 'TVB新闻', '無綫新聞台', '無線新聞台', '互動新聞台', '互动新闻台'] },
  { id: 'tvb-finance', name: '无线财经资讯台', group: '港澳台', epgId: 'TVBFinance', aliases: ['无线财经', 'TVB财经', '无线财经资讯台', 'TVBFINANCE'] },
  { id: 'tvb-j2', name: 'TVB Plus', group: '港澳台', epgId: 'TVBPlus', aliases: ['TVBJ2', 'J2', 'TVBPLUS', '无线J2'] },
  { id: 'tvb-hd-jade', name: '无线高清翡翠台', group: '港澳台', epgId: 'TVBHdJade', aliases: ['高清翡翠台', 'TVBHDJADE', '无线高清'] },
  { id: 'hk-open-tv', name: '香港开电视', group: '港澳台', epgId: 'HKOpenTV', aliases: ['香港开电视', '开电视', 'HKOPENTV', '奇妙电视'] },
  { id: 'viutv', name: 'ViuTV', group: '港澳台', epgId: 'ViuTV', aliases: ['VIUTV', 'VIU TV', '香港VIUTV'] },
  { id: 'viutv-six', name: 'ViuTVsix', group: '港澳台', epgId: 'ViuTVsix', aliases: ['VIUTVSIX', 'VIU6', 'VIUTV6'] },
  { id: 'rthk-31', name: '港台电视31', group: '港澳台', epgId: 'RTHK31', aliases: ['港台31', 'RTHK31', '香港电台31', '港台电视31'] },
  { id: 'rthk-32', name: '港台电视32', group: '港澳台', epgId: 'RTHK32', aliases: ['港台32', 'RTHK32', '香港电台32', '港台电视32'] },
  { id: 'rthk-33', name: '港台电视33', group: '港澳台', epgId: 'RTHK33', aliases: ['港台33', 'RTHK33', '香港电台33', '港台电视33'] },
  { id: 'phoenix-chinese', name: '凤凰卫视中文台', group: '港澳台', epgId: 'PhoenixChinese', aliases: ['凤凰卫视', '凤凰中文台', '凤凰卫视中文台', 'PHOENIXCHINESE', '凤凰'] },
  { id: 'phoenix-info', name: '凤凰卫视资讯台', group: '港澳台', epgId: 'PhoenixInfo', aliases: ['凤凰资讯台', '凤凰卫视资讯台', 'PHOENIXINFO', '凤凰资讯'] },
  { id: 'phoenix-hk', name: '凤凰卫视香港台', group: '港澳台', epgId: 'PhoenixHK', aliases: ['凤凰香港台', '凤凰卫视香港台', 'PHOENIXHK'] },
  { id: 'now-news', name: 'now 新闻台', group: '港澳台', epgId: 'NowNews', aliases: ['NOW新闻台', 'NOWTV新闻', 'NOW新闻'] },
  { id: 'now-finance', name: 'now 财经台', group: '港澳台', epgId: 'NowFinance', aliases: ['NOW财经台', 'NOWTV财经', 'NOW财经'] },
  { id: 'tcl-macau', name: '澳视澳门', group: '港澳台', epgId: 'TDMChn', aliases: ['澳视澳门', '澳门澳视', 'TDM澳门', '澳门卫视', '澳视', '澳視澳門', '澳門澳視'] },
  { id: 'tdm-portuguese', name: '澳视葡文', group: '港澳台', epgId: 'TDMCanalMacau', aliases: ['澳视葡文', '澳視葡文', '澳门葡文台', 'TDMCanalMacau'] },
  { id: 'hoy-tv', name: 'HOY TV', group: '港澳台', epgId: 'HOYTV', aliases: ['HOYTV', 'HOY TV', 'HOY77', 'HOY 77', 'HOY77台', '奇妙77台', '奇妙電視77台'] },
  { id: 'macau-lotus', name: '莲花卫视', group: '港澳台', epgId: 'LotusTV', aliases: ['莲花卫视', '澳门莲花'] },
  { id: 'ttv', name: '台视', group: '港澳台', epgId: 'TTV', aliases: ['台视', 'TTV', '台湾电视'] },
  { id: 'ctv-tw', name: '中视', group: '港澳台', epgId: 'CTV', aliases: ['中视', 'CTV', '中国电视'] },
  { id: 'cts', name: '华视', group: '港澳台', epgId: 'CTS', aliases: ['华视', 'CTS'] },
  { id: 'ptt', name: '公视', group: '港澳台', epgId: 'PTS', aliases: ['公视', 'PTS', '公共电视'] },
  { id: 'tvbs-news', name: 'TVBS 新闻台', group: '港澳台', epgId: 'TVBSNews', aliases: ['TVBS新闻', 'TVBSNEWS', 'TVBS新闻台'] },
  { id: 'cti-news', name: '中天新闻台', group: '港澳台', epgId: 'CTINews', aliases: ['中天新闻', '中天新闻台', 'CTINEWS'] },
  { id: 'ettv-news', name: '东森新闻台', group: '港澳台', epgId: 'ETTVNews', aliases: ['东森新闻', '东森新闻台', 'ETTVNEWS', '东森'] },
  { id: 'set-news', name: '三立新闻台', group: '港澳台', epgId: 'SETNews', aliases: ['三立新闻', '三立新闻台', 'SETNEWS', '三立'] },
  { id: 'ftv-news', name: '民视新闻台', group: '港澳台', epgId: 'FTVNews', aliases: ['民视新闻', '民视新闻台', 'FTVNEWS', '民视'] },
];

/** 广东本地频道规则。 */
const GD_RULES: ChannelRule[] = [
  { id: 'gd-zhujiang', name: '广东珠江', group: '广东', epgId: 'GDZhuJiang', aliases: ['广东珠江', '珠江频道', '珠江台', 'GDTV珠江', '珠江'] },
  { id: 'gd-sports', name: '广东体育', group: '广东', epgId: 'GDSports', aliases: ['广东体育', '广东体育频道', 'GDTV体育', '广东体育台'] },
  { id: 'gd-news', name: '广东新闻', group: '广东', epgId: 'GDNews', aliases: ['广东新闻', '广东新闻频道', 'GDTV新闻'] },
  { id: 'gd-public', name: '广东公共', group: '广东', epgId: 'GDPublic', aliases: ['广东公共', '广东公共频道', 'GDTV公共'] },
  { id: 'gd-economy', name: '广东经济科教', group: '广东', epgId: 'GDEconomy', aliases: ['广东经济科教', '广东科教', '广东经济', 'GDTV经济科教'] },
  { id: 'gd-movie', name: '广东影视', group: '广东', epgId: 'GDMovie', aliases: ['广东影视', '广东影视娱乐', 'GDTV影视'] },
  { id: 'gd-kids', name: '广东少儿', group: '广东', epgId: 'GDKids', aliases: ['广东少儿', '广东少儿频道', 'GDTV少儿'] },
  { id: 'gd-bayarea', name: '广东大湾区', group: '广东', epgId: 'GDBayArea', aliases: ['大湾区卫视', '广东大湾区', '大湾区频道', 'GDBayArea'] },
  { id: 'gd-southern', name: '南方卫视', group: '广东', epgId: 'SouthernTV', aliases: ['南方卫视', '南方电视台', 'SOUTHERNTV'] },
  { id: 'gz-general', name: '广州综合', group: '广东', epgId: 'GZGeneral', aliases: ['广州综合', '广州电视台综合', '广州台', 'GZTV综合'] },
  { id: 'gz-news', name: '广州新闻', group: '广东', epgId: 'GZNews', aliases: ['广州新闻', '广州新闻频道', 'GZTV新闻'] },
  { id: 'sz-city', name: '深圳都市', group: '广东', epgId: 'SZCity', aliases: ['深圳都市', '深圳都市频道', 'SZTV都市'] },
  { id: 'sz-drama', name: '深圳电视剧', group: '广东', epgId: 'SZDrama', aliases: ['深圳电视剧', '深圳电视剧频道', 'SZTV电视剧'] },
  { id: 'sz-finance', name: '深圳财经生活', group: '广东', epgId: 'SZFinance', aliases: ['深圳财经生活', '深圳财经', 'SZTV财经生活'] },
  { id: 'sz-entertainment', name: '深圳娱乐', group: '广东', epgId: 'SZEntertainment', aliases: ['深圳娱乐', '深圳娱乐频道', 'SZTV娱乐'] },
  { id: 'zh-zhuhai', name: '珠海综合', group: '广东', epgId: 'ZHZhuhai', aliases: ['珠海综合', '珠海台', '珠海电视台'] },
  { id: 'fs-foshan', name: '佛山综合', group: '广东', epgId: 'FSFoshan', aliases: ['佛山综合', '佛山台', '佛山电视台'] },
  { id: 'dg-dongguan', name: '东莞综合', group: '广东', epgId: 'DGDongguan', aliases: ['东莞综合', '东莞台', '东莞电视台'] },
  { id: 'zs-zhongshan', name: '中山综合', group: '广东', epgId: 'ZSZhongshan', aliases: ['中山综合', '中山台', '中山电视台'] },
  { id: 'hz-huizhou', name: '惠州综合', group: '广东', epgId: 'HZHuiZhou', aliases: ['惠州综合', '惠州台', '惠州电视台'] },
  { id: 'jm-jiangmen', name: '江门综合', group: '广东', epgId: 'JMJiangmen', aliases: ['江门综合', '江门台', '江门电视台'] },
  { id: 'st-shantou', name: '汕头综合', group: '广东', epgId: 'STShantou', aliases: ['汕头综合', '汕头台', '汕头电视台'] },
  { id: 'zj-zhanjiang', name: '湛江综合', group: '广东', epgId: 'ZJZhanjiang', aliases: ['湛江综合', '湛江台', '湛江电视台'] },
  { id: 'mm-maoming', name: '茂名综合', group: '广东', epgId: 'MMMaoming', aliases: ['茂名综合', '茂名台', '茂名电视台'] },
  { id: 'zq-zhaoqing', name: '肇庆综合', group: '广东', epgId: 'ZQZhaoqing', aliases: ['肇庆综合', '肇庆台', '肇庆电视台'] },
  { id: 'qy-qingyuan', name: '清远综合', group: '广东', epgId: 'QYQingyuan', aliases: ['清远综合', '清远台', '清远电视台'] },
  { id: 'sg-shaoguan', name: '韶关综合', group: '广东', epgId: 'SGShaoguan', aliases: ['韶关综合', '韶关台', '韶关电视台'] },
  { id: 'mz-meizhou', name: '梅州综合', group: '广东', epgId: 'MZMeizhou', aliases: ['梅州综合', '梅州台', '梅州电视台'] },
  { id: 'hy-heyuan', name: '河源综合', group: '广东', epgId: 'HYHeyuan', aliases: ['河源综合', '河源台', '河源电视台'] },
  { id: 'yj-yangjiang', name: '阳江综合', group: '广东', epgId: 'YJYangjiang', aliases: ['阳江综合', '阳江台', '阳江电视台'] },
  { id: 'yf-yunfu', name: '云浮综合', group: '广东', epgId: 'YFYunfu', aliases: ['云浮综合', '云浮台', '云浮电视台'] },
  { id: 'cz-chaozhou', name: '潮州综合', group: '广东', epgId: 'CZChaozhou', aliases: ['潮州综合', '潮州台', '潮州电视台'] },
  { id: 'jy-jieyang', name: '揭阳综合', group: '广东', epgId: 'JYJieyang', aliases: ['揭阳综合', '揭阳台', '揭阳电视台'] },
  { id: 'sw-shanwei', name: '汕尾综合', group: '广东', epgId: 'SWShanwei', aliases: ['汕尾综合', '汕尾台', '汕尾电视台'] },
];

/** 卫视规则。 */
const SATELLITE_RULES: ChannelRule[] = [
  { id: 'satellite-hunan', name: '湖南卫视', group: '卫视', epgId: 'HunanTV', aliases: ['湖南卫视', '湖南台'] },
  { id: 'satellite-zhejiang', name: '浙江卫视', group: '卫视', epgId: 'ZhejiangTV', aliases: ['浙江卫视', '浙江台'] },
  { id: 'satellite-jiangsu', name: '江苏卫视', group: '卫视', epgId: 'JiangsuTV', aliases: ['江苏卫视', '江苏台'] },
  { id: 'satellite-dragon', name: '东方卫视', group: '卫视', epgId: 'DragonTV', aliases: ['东方卫视', '上海东方卫视', '东方台'] },
  { id: 'satellite-beijing', name: '北京卫视', group: '卫视', epgId: 'BeijingTV', aliases: ['北京卫视', '北京台'] },
  { id: 'satellite-anhui', name: '安徽卫视', group: '卫视', epgId: 'AnhuiTV', aliases: ['安徽卫视', '安徽台'] },
  { id: 'satellite-shandong', name: '山东卫视', group: '卫视', epgId: 'ShandongTV', aliases: ['山东卫视', '山东台'] },
  { id: 'satellite-tianjin', name: '天津卫视', group: '卫视', epgId: 'TianjinTV', aliases: ['天津卫视', '天津台'] },
  { id: 'satellite-chongqing', name: '重庆卫视', group: '卫视', epgId: 'ChongqingTV', aliases: ['重庆卫视', '重庆台'] },
  { id: 'satellite-heilongjiang', name: '黑龙江卫视', group: '卫视', epgId: 'HeilongjiangTV', aliases: ['黑龙江卫视'] },
  { id: 'satellite-jilin', name: '吉林卫视', group: '卫视', epgId: 'JilinTV', aliases: ['吉林卫视'] },
  { id: 'satellite-liaoning', name: '辽宁卫视', group: '卫视', epgId: 'LiaoningTV', aliases: ['辽宁卫视'] },
  { id: 'satellite-hebei', name: '河北卫视', group: '卫视', epgId: 'HebeiTV', aliases: ['河北卫视'] },
  { id: 'satellite-henan', name: '河南卫视', group: '卫视', epgId: 'HenanTV', aliases: ['河南卫视'] },
  { id: 'satellite-shanxi', name: '山西卫视', group: '卫视', epgId: 'ShanxiTV', aliases: ['山西卫视'] },
  { id: 'satellite-shaanxi', name: '陕西卫视', group: '卫视', epgId: 'ShaanxiTV', aliases: ['陕西卫视'] },
  { id: 'satellite-gansu', name: '甘肃卫视', group: '卫视', epgId: 'GansuTV', aliases: ['甘肃卫视'] },
  { id: 'satellite-ningxia', name: '宁夏卫视', group: '卫视', epgId: 'NingxiaTV', aliases: ['宁夏卫视'] },
  { id: 'satellite-qinghai', name: '青海卫视', group: '卫视', epgId: 'QinghaiTV', aliases: ['青海卫视'] },
  { id: 'satellite-xinjiang', name: '新疆卫视', group: '卫视', epgId: 'XinjiangTV', aliases: ['新疆卫视'] },
  { id: 'satellite-neimenggu', name: '内蒙古卫视', group: '卫视', epgId: 'NeiMongolTV', aliases: ['内蒙古卫视', '内蒙卫视'] },
  { id: 'satellite-xizang', name: '西藏卫视', group: '卫视', epgId: 'XizangTV', aliases: ['西藏卫视'] },
  { id: 'satellite-yunnan', name: '云南卫视', group: '卫视', epgId: 'YunnanTV', aliases: ['云南卫视'] },
  { id: 'satellite-guizhou', name: '贵州卫视', group: '卫视', epgId: 'GuizhouTV', aliases: ['贵州卫视'] },
  { id: 'satellite-sichuan', name: '四川卫视', group: '卫视', epgId: 'SichuanTV', aliases: ['四川卫视'] },
  { id: 'satellite-hubei', name: '湖北卫视', group: '卫视', epgId: 'HubeiTV', aliases: ['湖北卫视'] },
  { id: 'satellite-jiangxi', name: '江西卫视', group: '卫视', epgId: 'JiangxiTV', aliases: ['江西卫视'] },
  { id: 'satellite-southeast', name: '东南卫视', group: '卫视', epgId: 'SoutheastTV', aliases: ['东南卫视', '福建东南卫视'] },
  { id: 'satellite-gd', name: '广东卫视', group: '卫视', epgId: 'GDStar', aliases: ['广东卫视', '广东电视台卫星频道'] },
  { id: 'satellite-guangxi', name: '广西卫视', group: '卫视', epgId: 'GuangxiTV', aliases: ['广西卫视'] },
  { id: 'satellite-hainan', name: '海南卫视', group: '卫视', epgId: 'HainanTV', aliases: ['海南卫视', '旅游卫视'] },
  { id: 'satellite-shenzhen', name: '深圳卫视', group: '卫视', epgId: 'SZTV', aliases: ['深圳卫视'] },
  { id: 'satellite-sansha', name: '三沙卫视', group: '卫视', epgId: 'SanshaTV', aliases: ['三沙卫视'] },
  { id: 'satellite-xiamen', name: '厦门卫视', group: '卫视', epgId: 'XiamenTV', aliases: ['厦门卫视'] },
  { id: 'satellite-yanbian', name: '延边卫视', group: '卫视', epgId: 'YanbianTV', aliases: ['延边卫视'] },
  { id: 'satellite-bingtuan', name: '兵团卫视', group: '卫视', epgId: 'BingtuanTV', aliases: ['兵团卫视'] },
  { id: 'satellite-kangba', name: '康巴卫视', group: '卫视', epgId: 'KangbaTV', aliases: ['康巴卫视'] },
  { id: 'satellite-agri', name: '农林卫视', group: '卫视', epgId: 'AgriTV', aliases: ['农林卫视'] },
];

/** 其他常客（不属上面四组但很常见的频道）。 */
const OTHER_RULES: ChannelRule[] = [
  { id: 'other-cartoon', name: '卡酷少儿', group: '其他', aliases: ['卡酷少儿', '卡酷动画', 'KAKU'] },
  { id: 'other-jinpai', name: '金鹰卡通', group: '其他', aliases: ['金鹰卡通', '金鹰卡通卫视'] },
  { id: 'other-haha', name: '哈哈炫动', group: '其他', aliases: ['哈哈炫动', '炫动卡通'] },
  { id: 'other-youman', name: '优漫卡通', group: '其他', aliases: ['优漫卡通'] },
  { id: 'other-jiaka', name: '嘉佳卡通', group: '其他', aliases: ['嘉佳卡通'] },
  { id: 'other-discovery', name: '探索频道', group: '其他', aliases: ['DISCOVERY', '探索频道'] },
  { id: 'other-national-geo', name: '国家地理', group: '其他', aliases: ['NATIONALGEOGRAPHIC', 'NATGEO', '国家地理'] },
  { id: 'other-cgtn', name: 'CGTN', group: '其他', aliases: ['CGTN', '中国国际电视台'] },
];

/**
 * 全量规则表：顺序即匹配优先级（港澳台 → 广东 → 央视特殊 → 卫视 → 其他）。
 * CCTV 纯编号频道（cctv1~cctv17）不在此表，由正则统一处理。
 */
export const CHANNEL_RULES: readonly ChannelRule[] = [
  ...HMT_RULES,
  ...GD_RULES,
  ...CCTV_SPECIAL_RULES,
  ...SATELLITE_RULES,
  ...OTHER_RULES,
];

/** EPG display-name 到 slug 的额外别名（上游 XMLTV 常见写法）。 */
export const EPG_NAME_ALIASES: Readonly<Record<string, string>> = {
  'CCTV1': 'cctv1',
  'CCTV-1': 'cctv1',
  'CCTV1综合': 'cctv1',
  '翡翠台': 'tvb-jade',
  'TVB Jade': 'tvb-jade',
  'Jade': 'tvb-jade',
  'Pearl': 'tvb-pearl',
  '明珠台': 'tvb-pearl',
  '凤凰中文': 'phoenix-chinese',
  '凤凰卫视': 'phoenix-chinese',
};

/** 规则总量自检用的期望下限（测试里断言，防止有人删规则）。 */
export const MIN_RULE_COUNT = 60;
