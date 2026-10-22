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

/**
 * 一条频道归一规则。
 *
 * 这里只描述**频道身份**（id / 名称 / 别名 / EPG / 台标），不含分组：
 * 分组一律走数据驱动（`data/group-keywords.json` 关键字 + `data/channel-overrides.json`
 * 人工覆盖），这样一个规则表命中与否都不会把频道锁死在旧分组上。
 */
export interface ChannelRule {
  /** 唯一 slug（ASCII，小写，可带连字符） */
  id: string;
  /** 标准中文名（展示用） */
  name: string;
  /** 命中该规则的原始写法（大小写、空格、标点由归一器忽略） */
  aliases: string[];
  /** 上游 XMLTV 里的 channel id（EPG 匹配用） */
  epgId?: string;
  /** 台标地址（缺失留空） */
  logo?: string;
}

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
    epgId: 'CCTV5Plus',
    aliases: ['CCTV5PLUS', 'CCTV5+', 'CCTV-5+', 'CCTV5加', '中央5加', '央视体育赛事', '体育赛事'],
  },
  {
    id: 'cctv4k',
    name: 'CCTV-4K 超高清',
    epgId: 'CCTV4K',
    aliases: ['CCTV4K', 'CCTV-4K', 'CCTV4K超高清', '央视4K', 'CCTV8K'],
  },
  {
    id: 'cetv1',
    name: '中国教育一套',
    epgId: 'CETV1',
    aliases: ['CETV1', 'CETV-1', '中国教育1台', '中国教育一套'],
  },
  {
    id: 'cetv4',
    name: '中国教育四套',
    epgId: 'CETV4',
    aliases: ['CETV4', 'CETV-4', '中国教育4台', '中国教育四套'],
  },
];

/**
 * 港澳台频道规则（优先命中，放在前面）。
 *
 * 说明：公开源里港澳台频道**大量使用英文名**（`Jade` / `Pearl` / `TVB News` /
 * `ViuTV` / `TDM Ou Mun`），只写中文名会全部落到哈希兜底 slug，导致同一台被拆成多条。
 * 因此每条规则都必须同时带英文名与繁体名的别名。
 */
const HMT_RULES: ChannelRule[] = [
  // ---------------------------------------------------------------- 香港 · TVB
  {
    id: 'tvb-jade',
    name: '翡翠台',
    epgId: 'TVBJade',
    aliases: ['Jade', 'TVB Jade', 'TVBJade', '無綫翡翠台', '无线翡翠台', '無線翡翠台', '翡翠台', 'TVB翡翠台', 'TVB翡翠', 'TVBJADE', '翡翠'],
  },
  {
    id: 'tvb-pearl',
    name: '明珠台',
    epgId: 'TVBPearl',
    aliases: ['Pearl', 'TVB Pearl', 'TVBPearl', '無綫明珠台', '无线明珠台', '明珠台', 'TVB明珠台', 'TVBPEARL', '明珠'],
  },
  {
    id: 'tvb-news',
    name: '无线新闻台',
    epgId: 'TVBNews',
    aliases: ['TVB News', '無綫新聞台', '無線新聞台', '无线新闻', '无线新闻台', 'TVBN', 'TVB新闻台', 'TVB新闻', '互動新聞台', '互动新闻台', 'TVBNEWS'],
  },
  {
    id: 'j2',
    name: 'J2',
    epgId: 'TVBPlus',
    aliases: ['J2', 'TVB J2', '無綫J2', '无线J2', 'TVBJ2', 'TVB Plus', 'TVBPLUS'],
  },
  {
    id: 'tvb-finance',
    name: '无线财经资讯台',
    epgId: 'TVBFinance',
    aliases: ['无线财经', 'TVB财经', '无线财经资讯台', 'TVBFINANCE', 'TVB Finance', '無綫財經台'],
  },
  {
    id: 'tvb-hd-jade',
    name: '无线高清翡翠台',
    epgId: 'TVBHdJade',
    aliases: ['高清翡翠台', 'TVBHDJADE', '无线高清', 'TVB HD Jade'],
  },
  // ---------------------------------------------------------------- 香港 · ViuTV / HOY
  {
    id: 'viutv',
    name: 'ViuTV',
    epgId: 'ViuTV',
    aliases: ['ViuTV', 'Viu TV', 'VIUTV', 'VIUTV99', 'ViuTV99', '99台', '香港VIUTV'],
  },
  {
    id: 'viutv-six',
    name: 'ViuTVsix',
    epgId: 'ViuTVsix',
    aliases: ['ViuTVsix', 'ViuTV six', 'VIUTVSIX', 'VIU6', 'VIUTV6', '96台'],
  },
  {
    id: 'hoy-tv',
    name: 'HOY TV',
    epgId: 'HOYTV',
    aliases: ['HOY TV', 'HOYTV', 'HOY', 'HOY77', 'HOY 77', 'HOY77台', '奇妙77台', '奇妙電視77台', '香港开电视', '開電視', '开电视', 'HKOPENTV', '奇妙电视'],
  },
  // ---------------------------------------------------------------- 香港 · RTHK 31~36
  // iptv-org 香港源的真实写法：`RTHK TV 31 (港台電視31) (1080p) [Geo-blocked]`
  // —— 去掉 `(1080p)` 与 `[Geo-blocked]` 后仍带 `(港台電視31)`，故两种写法都要收进别名。
  {
    id: 'rthk-31',
    name: '港台电视31',
    epgId: 'RTHK31',
    aliases: ['RTHK TV 31', 'RTHK 31', 'RTHKTV31', '港台電視31', '港台电视31', '港台31', 'RTHK31', '香港电台31', 'RTHK TV 31 (港台電視31)', 'RTHK 31 (港台電視31)'],
  },
  {
    id: 'rthk-32',
    name: '港台电视32',
    epgId: 'RTHK32',
    aliases: ['RTHK TV 32', 'RTHK 32', 'RTHKTV32', '港台電視32', '港台电视32', '港台32', 'RTHK32', '香港电台32', 'RTHK TV 32 (港台電視32)', 'RTHK 32 (港台電視32)'],
  },
  {
    id: 'rthk-33',
    name: '港台电视33',
    epgId: 'RTHK33',
    aliases: ['RTHK TV 33', 'RTHK 33', 'RTHKTV33', '港台電視33', '港台电视33', '港台33', 'RTHK33', '香港电台33', 'RTHK TV 33 (港台電視33)', 'RTHK 33 (港台電視33)'],
  },
  {
    id: 'rthk-34',
    name: '港台电视34',
    epgId: 'RTHK34',
    aliases: ['RTHK TV 34', 'RTHK 34', 'RTHKTV34', '港台電視34', '港台电视34', '港台34', 'RTHK34', '香港电台34', 'RTHK TV 34 (港台電視34)', 'RTHK 34 (港台電視34)'],
  },
  {
    id: 'rthk-35',
    name: '港台电视35',
    epgId: 'RTHK35',
    aliases: ['RTHK TV 35', 'RTHK 35', 'RTHKTV35', '港台電視35', '港台电视35', '港台35', 'RTHK35', '香港电台35', 'RTHK TV 35 (港台電視35)', 'RTHK 35 (港台電視35)'],
  },
  {
    id: 'rthk-36',
    name: '港台电视36',
    epgId: 'RTHK36',
    aliases: ['RTHK TV 36', 'RTHK 36', 'RTHKTV36', '港台電視36', '港台电视36', '港台36', 'RTHK36', '香港电台36', 'RTHK TV 36 (港台電視36)', 'RTHK 36 (港台電視36)'],
  },
  // ---------------------------------------------------------------- 香港 · 凤凰 / 香港卫视 / now
  {
    id: 'phoenix-chinese',
    name: '凤凰卫视中文台',
    epgId: 'PhoenixChinese',
    aliases: ['凤凰中文', '凤凰卫视', '鳳凰衛視', 'Phoenix Chinese', '凤凰中文台', '凤凰卫视中文台', 'PHOENIXCHINESE', '凤凰'],
  },
  {
    id: 'phoenix-info',
    name: '凤凰卫视资讯台',
    epgId: 'PhoenixInfo',
    aliases: ['凤凰资讯', '鳳凰資訊', 'Phoenix InfoNews', 'Phoenix Info', '凤凰资讯台', '凤凰卫视资讯台', 'PHOENIXINFO'],
  },
  {
    id: 'phoenix-hk',
    name: '凤凰卫视香港台',
    epgId: 'PhoenixHK',
    aliases: ['凤凰香港', '鳳凰香港', 'Phoenix HK', '凤凰香港台', '凤凰卫视香港台', 'PHOENIXHK'],
  },
  {
    id: 'hkstv',
    name: '香港卫视',
    epgId: 'HKSTV',
    aliases: ['香港卫视', '香港衛視', 'Hong Kong Satellite TV', 'HKSTV'],
  },
  {
    id: 'now-news',
    name: 'now 新闻台',
    epgId: 'NowNews',
    aliases: ['NOW新闻台', 'NOWTV新闻', 'NOW新闻', 'now News'],
  },
  {
    id: 'now-finance',
    name: 'now 财经台',
    epgId: 'NowFinance',
    aliases: ['NOW财经台', 'NOWTV财经', 'NOW财经', 'now Finance'],
  },
  // ---------------------------------------------------------------- 澳门（TDM / 莲花）
  {
    id: 'tdm-oumun',
    name: '澳视澳门',
    epgId: 'TDMChn',
    aliases: ['澳视澳门', '澳視澳門', 'TDM Ou Mun', 'TDM澳門', 'TDM澳门', '澳门澳视', '澳門澳視', 'TDM OUMUN', '澳视', '澳门卫视'],
  },
  {
    id: 'tdm-pm',
    name: '澳视葡文',
    epgId: 'TDMCanalMacau',
    aliases: ['澳视葡文', '澳視葡文', 'TDM Canal Macau', 'TDMCANALMACAU', 'TDM葡文', '澳门葡文台'],
  },
  {
    id: 'lotus-macau',
    name: '澳门莲花卫视',
    epgId: 'LotusTV',
    aliases: ['澳门莲花卫视', '澳門蓮花衛視', 'Lotus Macau', 'LOTUSMACAU', '莲花卫视', '澳门莲花', '澳門蓮花'],
  },
  // ---------------------------------------------------------------- 台湾
  {
    id: 'ttv',
    name: '台视',
    epgId: 'TTV',
    aliases: ['台视', '台視', 'TTV', '台湾电视', 'TTV HD'],
  },
  {
    id: 'ctv-tw',
    name: '中视',
    epgId: 'CTV',
    aliases: ['中视', '中視', 'CTV', 'CTV TW', '中国电视'],
  },
  {
    id: 'cts',
    name: '华视',
    epgId: 'CTS',
    aliases: ['华视', '華視', 'CTS'],
  },
  {
    id: 'ptt',
    name: '公视',
    epgId: 'PTS',
    aliases: ['公视', '公視', 'PTS', '公共电视', '公共電視'],
  },
  {
    id: 'tvbs-news',
    name: 'TVBS 新闻台',
    epgId: 'TVBSNews',
    aliases: ['TVBS', 'TVBS Asia', 'TVBS 新闻台', 'TVBS新闻', 'TVBS新闻台', 'TVBSNEWS', 'TVBS新聞'],
  },
  {
    id: 'cti-news',
    name: '中天新闻台',
    epgId: 'CTINews',
    aliases: ['中天新闻', '中天新聞', '中天新闻台', '中天新聞台', 'CTINEWS'],
  },
  {
    id: 'ettv-news',
    name: '东森新闻台',
    epgId: 'ETTVNews',
    aliases: ['东森', '東森', '东森新闻', '東森新聞', '东森新闻台', 'ETTVNEWS'],
  },
  {
    id: 'set-news',
    name: '三立新闻台',
    epgId: 'SETNews',
    aliases: ['三立', '三立新闻', '三立新聞', '三立新闻台', 'SETNEWS'],
  },
  {
    id: 'ftv-news',
    name: '民视新闻台',
    epgId: 'FTVNews',
    aliases: ['民视', '民視', '民视新闻', '民視新聞', '民视新闻台', 'FTVNEWS', 'FTV'],
  },
  {
    id: 'videoland',
    name: '纬来',
    epgId: 'Videoland',
    aliases: ['纬来', '緯來', 'Videoland', 'VIDEOLAND', '纬来综合', '緯來綜合'],
  },
];

/**
 * 广东本地频道规则。
 *
 * ⚠️ 背景（别改回去）：
 * - `南方卫视` 已于 2022-07-29 经广电总局批准更名为 `大湾区卫视`，公开源里**不存在**"南方卫视"，
 *   所以必须靠别名把它映射到 `gd-bayarea`（大湾区卫视）。
 * - 广东广播电视台的 TVS 系列编号：TVS-1 经济科教、TVS-2 南方/大湾区、TVS-3 综艺（**2018 年已停播，不要加**）、
 *   TVS-4 影视、TVS-5 少儿。
 */
const GD_RULES: ChannelRule[] = [
  { id: 'gd-zhujiang', name: '广东珠江', epgId: 'GDZhuJiang', aliases: ['广东珠江', '珠江频道', '珠江台', 'GDTV珠江', '珠江'] },
  { id: 'gd-sports', name: '广东体育', epgId: 'GDSports', aliases: ['广东体育', '广东体育频道', 'GDTV体育', '广东体育台'] },
  { id: 'gd-news', name: '广东新闻', epgId: 'GDNews', aliases: ['广东新闻', '广东新闻频道', 'GDTV新闻'] },
  { id: 'gd-public', name: '广东公共', epgId: 'GDPublic', aliases: ['广东公共', '广东公共频道', 'GDTV公共'] },
  // 大湾区卫视（原南方卫视，TVS-2）
  { id: 'gd-bayarea', name: '大湾区卫视', epgId: 'GDBayArea', aliases: ['大湾区卫视', '大灣區衛視', '南方卫视', '南方衛視', 'TVS-2', 'TVS2', '广东大湾区', '大湾区频道', 'GDBayArea'] },
  // 广东经济科教（TVS-1）
  { id: 'gd-tvs1', name: '广东经济科教', epgId: 'GDEconomy', aliases: ['广东经济科教', '南方经济科教', 'TVS-1', 'TVS1', '广东经视', '广东科教', '广东经济', 'GDTV经济科教'] },
  // 广东影视（TVS-4）
  { id: 'gd-tvs4', name: '广东影视', epgId: 'GDMovie', aliases: ['广东影视', '南方影视', 'TVS-4', 'TVS4', '广东影视娱乐', 'GDTV影视'] },
  // 广东少儿（TVS-5）
  { id: 'gd-tvs5', name: '广东少儿', epgId: 'GDKids', aliases: ['广东少儿', '南方少儿', 'TVS-5', 'TVS5', '广东少儿频道', 'GDTV少儿'] },
  { id: 'gz-general', name: '广州综合', epgId: 'GZGeneral', aliases: ['广州综合', '广州电视台综合', '广州台', 'GZTV综合'] },
  { id: 'gz-news', name: '广州新闻', epgId: 'GZNews', aliases: ['广州新闻', '广州新闻频道', 'GZTV新闻'] },
  { id: 'sz-city', name: '深圳都市', epgId: 'SZCity', aliases: ['深圳都市', '深圳都市频道', 'SZTV都市'] },
  { id: 'sz-drama', name: '深圳电视剧', epgId: 'SZDrama', aliases: ['深圳电视剧', '深圳电视剧频道', 'SZTV电视剧'] },
  { id: 'sz-finance', name: '深圳财经生活', epgId: 'SZFinance', aliases: ['深圳财经生活', '深圳财经', 'SZTV财经生活'] },
  { id: 'sz-entertainment', name: '深圳娱乐', epgId: 'SZEntertainment', aliases: ['深圳娱乐', '深圳娱乐频道', 'SZTV娱乐'] },
  { id: 'zh-zhuhai', name: '珠海综合', epgId: 'ZHZhuhai', aliases: ['珠海综合', '珠海台', '珠海电视台'] },
  { id: 'fs-foshan', name: '佛山综合', epgId: 'FSFoshan', aliases: ['佛山综合', '佛山台', '佛山电视台'] },
  { id: 'dg-dongguan', name: '东莞综合', epgId: 'DGDongguan', aliases: ['东莞综合', '东莞台', '东莞电视台'] },
  { id: 'zs-zhongshan', name: '中山综合', epgId: 'ZSZhongshan', aliases: ['中山综合', '中山台', '中山电视台'] },
  { id: 'hz-huizhou', name: '惠州综合', epgId: 'HZHuiZhou', aliases: ['惠州综合', '惠州台', '惠州电视台'] },
  { id: 'jm-jiangmen', name: '江门综合', epgId: 'JMJiangmen', aliases: ['江门综合', '江门台', '江门电视台'] },
  { id: 'st-shantou', name: '汕头综合', epgId: 'STShantou', aliases: ['汕头综合', '汕头台', '汕头电视台'] },
  { id: 'zj-zhanjiang', name: '湛江综合', epgId: 'ZJZhanjiang', aliases: ['湛江综合', '湛江台', '湛江电视台'] },
  { id: 'mm-maoming', name: '茂名综合', epgId: 'MMMaoming', aliases: ['茂名综合', '茂名台', '茂名电视台'] },
  { id: 'zq-zhaoqing', name: '肇庆综合', epgId: 'ZQZhaoqing', aliases: ['肇庆综合', '肇庆台', '肇庆电视台'] },
  { id: 'qy-qingyuan', name: '清远综合', epgId: 'QYQingyuan', aliases: ['清远综合', '清远台', '清远电视台'] },
  { id: 'sg-shaoguan', name: '韶关综合', epgId: 'SGShaoguan', aliases: ['韶关综合', '韶关台', '韶关电视台'] },
  { id: 'mz-meizhou', name: '梅州综合', epgId: 'MZMeizhou', aliases: ['梅州综合', '梅州台', '梅州电视台'] },
  { id: 'hy-heyuan', name: '河源综合', epgId: 'HYHeyuan', aliases: ['河源综合', '河源台', '河源电视台'] },
  { id: 'yj-yangjiang', name: '阳江综合', epgId: 'YJYangjiang', aliases: ['阳江综合', '阳江台', '阳江电视台'] },
  { id: 'yf-yunfu', name: '云浮综合', epgId: 'YFYunfu', aliases: ['云浮综合', '云浮台', '云浮电视台'] },
  { id: 'cz-chaozhou', name: '潮州综合', epgId: 'CZChaozhou', aliases: ['潮州综合', '潮州台', '潮州电视台'] },
  { id: 'jy-jieyang', name: '揭阳综合', epgId: 'JYJieyang', aliases: ['揭阳综合', '揭阳台', '揭阳电视台'] },
  { id: 'sw-shanwei', name: '汕尾综合', epgId: 'SWShanwei', aliases: ['汕尾综合', '汕尾台', '汕尾电视台'] },
];

/** 卫视规则。 */
const SATELLITE_RULES: ChannelRule[] = [
  { id: 'satellite-hunan', name: '湖南卫视', epgId: 'HunanTV', aliases: ['湖南卫视', '湖南台'] },
  { id: 'satellite-zhejiang', name: '浙江卫视', epgId: 'ZhejiangTV', aliases: ['浙江卫视', '浙江台'] },
  { id: 'satellite-jiangsu', name: '江苏卫视', epgId: 'JiangsuTV', aliases: ['江苏卫视', '江苏台'] },
  { id: 'satellite-dragon', name: '东方卫视', epgId: 'DragonTV', aliases: ['东方卫视', '上海东方卫视', '东方台'] },
  { id: 'satellite-beijing', name: '北京卫视', epgId: 'BeijingTV', aliases: ['北京卫视', '北京台'] },
  { id: 'satellite-anhui', name: '安徽卫视', epgId: 'AnhuiTV', aliases: ['安徽卫视', '安徽台'] },
  { id: 'satellite-shandong', name: '山东卫视', epgId: 'ShandongTV', aliases: ['山东卫视', '山东台'] },
  { id: 'satellite-tianjin', name: '天津卫视', epgId: 'TianjinTV', aliases: ['天津卫视', '天津台'] },
  { id: 'satellite-chongqing', name: '重庆卫视', epgId: 'ChongqingTV', aliases: ['重庆卫视', '重庆台'] },
  { id: 'satellite-heilongjiang', name: '黑龙江卫视', epgId: 'HeilongjiangTV', aliases: ['黑龙江卫视'] },
  { id: 'satellite-jilin', name: '吉林卫视', epgId: 'JilinTV', aliases: ['吉林卫视'] },
  { id: 'satellite-liaoning', name: '辽宁卫视', epgId: 'LiaoningTV', aliases: ['辽宁卫视'] },
  { id: 'satellite-hebei', name: '河北卫视', epgId: 'HebeiTV', aliases: ['河北卫视'] },
  { id: 'satellite-henan', name: '河南卫视', epgId: 'HenanTV', aliases: ['河南卫视'] },
  { id: 'satellite-shanxi', name: '山西卫视', epgId: 'ShanxiTV', aliases: ['山西卫视'] },
  { id: 'satellite-shaanxi', name: '陕西卫视', epgId: 'ShaanxiTV', aliases: ['陕西卫视'] },
  { id: 'satellite-gansu', name: '甘肃卫视', epgId: 'GansuTV', aliases: ['甘肃卫视'] },
  { id: 'satellite-ningxia', name: '宁夏卫视', epgId: 'NingxiaTV', aliases: ['宁夏卫视'] },
  { id: 'satellite-qinghai', name: '青海卫视', epgId: 'QinghaiTV', aliases: ['青海卫视'] },
  { id: 'satellite-xinjiang', name: '新疆卫视', epgId: 'XinjiangTV', aliases: ['新疆卫视'] },
  { id: 'satellite-neimenggu', name: '内蒙古卫视', epgId: 'NeiMongolTV', aliases: ['内蒙古卫视', '内蒙卫视'] },
  { id: 'satellite-xizang', name: '西藏卫视', epgId: 'XizangTV', aliases: ['西藏卫视'] },
  { id: 'satellite-yunnan', name: '云南卫视', epgId: 'YunnanTV', aliases: ['云南卫视'] },
  { id: 'satellite-guizhou', name: '贵州卫视', epgId: 'GuizhouTV', aliases: ['贵州卫视'] },
  { id: 'satellite-sichuan', name: '四川卫视', epgId: 'SichuanTV', aliases: ['四川卫视'] },
  { id: 'satellite-hubei', name: '湖北卫视', epgId: 'HubeiTV', aliases: ['湖北卫视'] },
  { id: 'satellite-jiangxi', name: '江西卫视', epgId: 'JiangxiTV', aliases: ['江西卫视'] },
  { id: 'satellite-southeast', name: '东南卫视', epgId: 'SoutheastTV', aliases: ['东南卫视', '福建东南卫视'] },
  { id: 'satellite-gd', name: '广东卫视', epgId: 'GDStar', aliases: ['广东卫视', '广东电视台卫星频道'] },
  { id: 'satellite-guangxi', name: '广西卫视', epgId: 'GuangxiTV', aliases: ['广西卫视'] },
  { id: 'satellite-hainan', name: '海南卫视', epgId: 'HainanTV', aliases: ['海南卫视', '旅游卫视'] },
  { id: 'satellite-shenzhen', name: '深圳卫视', epgId: 'SZTV', aliases: ['深圳卫视'] },
  { id: 'satellite-sansha', name: '三沙卫视', epgId: 'SanshaTV', aliases: ['三沙卫视'] },
  { id: 'satellite-xiamen', name: '厦门卫视', epgId: 'XiamenTV', aliases: ['厦门卫视'] },
  { id: 'satellite-yanbian', name: '延边卫视', epgId: 'YanbianTV', aliases: ['延边卫视'] },
  { id: 'satellite-bingtuan', name: '兵团卫视', epgId: 'BingtuanTV', aliases: ['兵团卫视'] },
  { id: 'satellite-kangba', name: '康巴卫视', epgId: 'KangbaTV', aliases: ['康巴卫视'] },
  { id: 'satellite-agri', name: '农林卫视', epgId: 'AgriTV', aliases: ['农林卫视'] },
];

/** 其他常客（不属上面四组但很常见的频道）。 */
const OTHER_RULES: ChannelRule[] = [
  { id: 'other-cartoon', name: '卡酷少儿', aliases: ['卡酷少儿', '卡酷动画', 'KAKU'] },
  { id: 'other-jinpai', name: '金鹰卡通', aliases: ['金鹰卡通', '金鹰卡通卫视'] },
  { id: 'other-haha', name: '哈哈炫动', aliases: ['哈哈炫动', '炫动卡通'] },
  { id: 'other-youman', name: '优漫卡通', aliases: ['优漫卡通'] },
  { id: 'other-jiaka', name: '嘉佳卡通', aliases: ['嘉佳卡通'] },
  { id: 'other-discovery', name: '探索频道', aliases: ['DISCOVERY', '探索频道'] },
  { id: 'other-national-geo', name: '国家地理', aliases: ['NATIONALGEOGRAPHIC', 'NATGEO', '国家地理'] },
  { id: 'other-cgtn', name: 'CGTN', aliases: ['CGTN', '中国国际电视台'] },
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
  'TDM Ou Mun': 'tdm-oumun',
  '澳視澳門': 'tdm-oumun',
  '澳视澳门': 'tdm-oumun',
  'Lotus Macau': 'lotus-macau',
  'GDBayArea': 'gd-bayarea',
  '大湾区卫视': 'gd-bayarea',
};

/**
 * 上游 `group-title` / `#genre#` 分组名 → 分组的提示规则。
 *
 * 为什么需要它：`guovin/iptv-api` 这类聚合源自带分组（`group-title="☘️广东频道"`），
 * 这是比"猜频道名"强得多的分类信号 —— 例如 `佛山综合` 靠名字也能猜，但
 * `CCTV-1 综合` 在不同上下文里可能是港澳台转发源，此时上游分组才是真相。
 *
 * 注意：它只是**提示**，优先级低于命中归一规则后由关键字数据算出的分组
 * （见 `normalize/group.ts` 的四级判定）。顺序即匹配优先级。
 */
export interface GroupHintRule {
  /** 匹配分组名（已去掉 emoji / 符号）的正则 */
  pattern: RegExp;
  /** 命中的分组 */
  group: GroupKey;
}

export const GROUP_HINT_RULES: readonly GroupHintRule[] = [
  { pattern: /港澳|香港|澳门|澳門|台湾|台灣|港台|TVB/i, group: '港澳台' },
  {
    pattern: /广东|廣東|广州|廣州|深圳|佛山|东莞|珠海|中山|惠州|汕头|江门|珠江|大湾区|粤/,
    group: '广东',
  },
  { pattern: /央视|央視|CCTV|中央/i, group: '央视' },
  { pattern: /卫视|衛視/, group: '卫视' },
];

/**
 * 去掉分组名里的 emoji / 装饰符号（上游常见 `☘️广东频道`、`📺央视`）。
 *
 * 只保留字母、数字、汉字（`\p{L}` 已含汉字），其余（emoji、变体选择符、空格、
 * 横线、括号）全部丢弃，避免装饰符把正则隔断。
 *
 * @param raw 上游分组名
 * @return 纯文字分组名
 */
export function stripGroupDecorations(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * 把上游分组名映射成本仓库的分组（识别不出时返回 `undefined`）。
 *
 * @param raw 上游分组名（可能带 emoji，可能为空）
 * @return 分组或 undefined
 */
export function hintGroupFromTitle(raw: string | undefined): GroupKey | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const cleaned = stripGroupDecorations(raw);
  if (cleaned.length === 0) {
    return undefined;
  }
  for (const rule of GROUP_HINT_RULES) {
    if (rule.pattern.test(cleaned)) {
      return rule.group;
    }
  }
  return undefined;
}

/** 规则总量自检用的期望下限（测试里断言，防止有人删规则）。 */
export const MIN_RULE_COUNT = 80;
