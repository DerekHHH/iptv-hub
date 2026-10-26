/**
 * @file 赛事直播的**联赛推断**（上游没有联赛字段，只能靠队名反推）。
 *
 * 上游 wudaliansai 的 `/live.m3u` 只给三个大类 `group-title`（足球 / 篮球 / 电竞），
 * **每条只有 `队名A vs 队名B|状态或线路`，没有任何联赛字段**。所以「这场是哪项联赛」
 * 只能靠**队名推断**：把各联赛队名的常见中文译名收成一张关键词表，命中即认为是该联赛。
 *
 * 匹配规则：
 *   1. **按关键词长度倒序**匹配（长关键词优先），避免「湖人」抢在「洛杉矶湖人」前面，
 *      也避免子串误命中；匹配按「包含」处理，所以上游写成 `CSJL骑士` / `SSCR雄鹿`
 *      这类带前缀的样子也能命中。
 *   2. 一场比赛的两边队可能分属不同联赛（跨联盟比赛），此时**取第一个命中**。
 *   3. `其他联赛` 优先级最低：先找具体联赛，找不到才兜底。
 *
 * 覆盖范围是「基础版」：篮球 NBA / CBA，足球五大联赛 + 中超 + 欧冠，电竞不细分。
 * 其余小联赛（KBL、B.League、澳洲 NBL、中美洲小联赛…）一律落 `其他联赛`。
 */

import { detectGame, GAME_ORDER, gameRank, OTHER_GAME } from './esports-teams';

/** 兜底联赛名（具体联赛都判不出来时用）。 */
export const OTHER_LEAGUE = '其他联赛';

/** 电竞的兜底项目名（识别不出游戏时用）。 */
export const ESPORTS_LEAGUE = OTHER_GAME;

/**
 * 平铺模式下的**全局**联赛顺序（分组已经改成一级，不再有「篮球|」前缀）。
 *
 * 篮球在前、足球次之、电竞随后，兜底分组永远垫底。
 */
export const FLAT_LEAGUE_ORDER: readonly string[] = [
  'NBA', 'CBA',
  '英超', '西甲', '意甲', '德甲', '法甲', '中超', '欧冠',
  '英雄联盟', 'CS2', 'DOTA2', '王者荣耀',
  OTHER_LEAGUE, OTHER_GAME,
];

/**
 * 各分类下的联赛展示顺序。
 *
 * 排序（`compareMatches`）按这个数组的下标走，**不要在比较器里写死顺序**。
 * 「其他联赛」永远排在最后。
 */
export const LEAGUE_ORDER: Readonly<Record<string, readonly string[]>> = {
  篮球: ['NBA', 'CBA', OTHER_LEAGUE],
  足球: ['英超', '西甲', '意甲', '德甲', '法甲', '中超', '欧冠', OTHER_LEAGUE],
  电竞: [ESPORTS_LEAGUE],
};

/**
 * 分类 → 联赛 → 该联赛队名的常见中文译名（含简称、含上游的前缀缩写写法）。
 *
 * 只收「具体联赛」；`其他联赛` 的队名另表存放（见 `FOREIGN_TEAMS`）。
 */
const LEAGUE_TEAMS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  篮球: {
    NBA: [
      '亚特兰大老鹰', '老鹰',
      '波士顿凯尔特人', '凯尔特人',
      '布鲁克林篮网', '篮网',
      '夏洛特黄蜂', '黄蜂',
      '芝加哥公牛', '公牛',
      '克利夫兰骑士', '骑士',
      '达拉斯独行侠', '独行侠', '小牛',
      '丹佛掘金', '掘金',
      '底特律活塞', '活塞',
      '金州勇士', '勇士',
      '休斯顿火箭', '火箭',
      '印第安纳步行者', '步行者',
      '洛杉矶快船', '快船',
      '洛杉矶湖人', '湖人',
      '孟菲斯灰熊', '灰熊',
      '迈阿密热火', '热火',
      '密尔沃基雄鹿', '雄鹿',
      '明尼苏达森林狼', '森林狼',
      '新奥尔良鹈鹕', '鹈鹕',
      '纽约尼克斯', '尼克斯',
      '俄克拉荷马雷霆', '雷霆',
      '奥兰多魔术', '魔术',
      '费城76人', '76人',
      '菲尼克斯太阳', '太阳',
      '波特兰开拓者', '开拓者',
      '萨克拉门托国王', '国王',
      '圣安东尼奥马刺', '马刺',
      '多伦多猛龙', '猛龙',
      '华盛顿奇才', '奇才', '巫师',
    ],
    CBA: [
      '广东宏远', '宏远', '广东东莞大益', '东莞大益', '广东',
      '辽宁本钢', '本钢', '辽宁',
      '北京首钢', '首钢', '北京',
      '浙江稠州', '稠州', '浙江广厦', '广厦',
      '深圳马可波罗', '马可波罗', '深圳新世纪', '新世纪', '深圳',
      '上海久事', '久事', '上海哔哩哔哩', '哔哩哔哩', '上海',
      '新疆伊力特', '伊力特', '新疆',
      '江苏肯帝亚', '肯帝亚', '江苏',
      '山东高速', '山东',
      '北京北控', '北控',
      '天津先行者', '先行者', '天津',
      '广州龙狮', '龙狮', '广州',
      '八一南昌', '八一', '南昌',
      '山西汾酒', '汾酒', '山西',
      '吉林九台农商', '九台农商', '吉林农商', '吉林',
    ],
  },
  足球: {
    英超: [
      '阿森纳', '利物浦', '曼城', '曼彻斯特城', '曼联', '曼彻斯特联', '切尔西',
      '热刺', '托特纳姆热刺', '纽卡斯尔联', '阿斯顿维拉', '维拉', '布莱顿',
      '西汉姆', '西汉姆联', '埃弗顿', '富勒姆', '狼队', '水晶宫', '诺丁汉森林',
      '利兹联', '莱斯特城', '南安普顿', '伯恩利', '布伦特福德', '伊普斯维奇', '桑德兰',
    ],
    西甲: [
      '皇家马德里', '皇马', '巴塞罗那', '巴萨', '马德里竞技', '马竞', '竞技马德里',
      '塞维利亚', '皇家社会', '毕尔巴鄂竞技', '毕尔巴鄂', '贝蒂斯', '比利亚雷亚尔',
      '瓦伦西亚', '赫塔菲', '奥萨苏纳', '塞尔塔', '拉斯帕尔马斯', '西班牙人',
      '马略卡', '埃斯帕尼奥尔', '赫罗纳', '吉罗纳', '巴列卡诺', '阿尔梅里亚',
      '莱加内斯', '埃尔切', '巴利亚多利德', '莱万特',
    ],
    意甲: [
      '国际米兰', '国米', 'AC米兰', 'AC 米兰', '米兰', '尤文图斯', '尤文', '那不勒斯',
      '罗马', '拉齐奥', '亚特兰大', '佛罗伦萨', '都灵', '博洛尼亚', '乌迪内斯',
      '维罗纳', '莱切', '热那亚', '桑普多利亚', '卡利亚里', '科莫', '蒙扎',
      '恩波利', '威尼斯', '萨索洛',
    ],
    德甲: [
      '拜仁仁', '拜仁慕尼黑', '拜仁', '多特蒙德', '勒沃库森', 'RB莱比锡', '莱比锡红牛',
      '莱比锡', '法兰克福', '沃尔夫斯堡', '门兴格拉德巴赫', '门兴', '弗赖堡',
      '斯图加特', '云达不莱梅', '沙尔克04', '柏林联合', '美因茨', '奥格斯堡',
      '霍芬海姆', '波鸿', '科隆', '汉堡', '圣保利', '柏林赫塔',
    ],
    法甲: [
      '巴黎圣日耳曼', '大巴黎', '巴黎', '摩纳哥', '马赛', '里昂', '里尔', '尼斯',
      '雷恩', '斯特拉斯堡', '朗斯', '南特', '蒙彼利埃', '图卢兹', '布雷斯特',
      '勒阿弗尔', '兰斯', '洛里昂', '昂热', '欧塞尔', '圣埃蒂安', '梅斯', '第戎',
      '卡昂', '尼姆',
    ],
    中超: [
      '山东泰山', '山东', '上海海港', '上港', '海港', '上海申花', '申花', '上海',
      '北京国安', '国安', '浙江队', '浙江', '武汉三镇', '三镇', '武汉',
      '天津津门虎', '津门虎', '天津', '河南队', '河南', '成都蓉城', '蓉城', '成都',
      '大连人', '大连', '长春亚泰', '亚泰', '青岛海牛', '海牛', '青岛',
      '梅州客家', '客家', '梅州', '深圳新鹏城', '新鹏城', '鹏城', '深圳',
      '沧州雄狮', '沧州', '南通支云', '支云', '南通', '昆山', '青岛西海岸', '西海岸',
      '杭州临平吴越', '临平吴越',
    ],
  },
  电竞: {},
};

/**
 * 其它联赛的队名（KBL / B.League / 澳洲 NBL / 拉美小联赛…）。
 *
 * 这张表**不代表某个具体联赛**，命中的统一归到 `其他联赛`。收录它是为了解决
 * 子串误命中：例如澳洲 NBL 的「伊拉瓦拉老鹰」若不管，「老鹰」会把整场误判成 NBA；
 * 有了更长的关键词，`其他联赛` 才能压过短关键词。
 */
const FOREIGN_TEAMS: Readonly<Record<string, readonly string[]>> = {
  篮球: [
    // 韩国 KBL
    '水原KT音速弹', '水原音速弹', '原州东浦新世代', '东浦新世代',
    '首尔SK飞鸟', '蔚山现代太阳神', '大邱KOGAS', '昌原LG', '釜山KCC',
    '高阳KDB', '韩国SK', '水原',
    // 日本 B.League
    '东京八王子市火车', '八王子市火车', '滋贺湖', '长崎维尔卡', '千叶君津',
    '川崎勇者', '仙台89人', '广岛龙', '熊本', '岛津', '琉球', '秋田', '山形',
    '新泻阿尔比', '新潟阿尔比', '富杉', '富山勇士', '筑波',
    // ↑ 这一段是从真实数据里补的：下面这些队名里含 NBA 队名（太阳、公牛…），
    //   没有更长的条目就会被误判成 NBA
    '东京太阳摇滚', '太阳摇滚', '兰实公牛', '巴苏孟要塞', '大阪七福神',
    '福冈新锐', '东京地球之友', '品川区篮球队', '三重十四', '东京联合',
    // 澳洲 NBL
    '蜜蜂', '墨尔本联', '墨尔本猛龙', '悉尼国王', '伊拉瓦拉老鹰', '珀斯野猫',
    '布里斯班老虎', '凯恩斯', '阿德莱德36人', '纽卡斯尔巨蛇', '南海岸',
    // 美洲 / 其它
    '卡德', '耶鲁竞技', '科尔多瓦学院', '北方莫蒂隆人', '波哥大船长',
    '佩纳罗尔', '乌伦代大学', '体育大学', '健行科技大学', '康塞普西翁大学',
    '安库德', '戈尔甘城市', '拉帕达凡伊斯法罕', '格努尔伊斯法罕',
    '南扎格罗斯', '塔斯马尼亚珍宝', '南区飞人女篮', '圣塔特卡拉', '哈蒂洛牧场主',
    '摩卡', '圣桑图尔奇', '伊萨贝拉', '均安', '荃湾', '明火', '卡里杜罗斯',
    '马纳蒂', '庞塞母', '卡瓜斯', 'LM罗梅洛蒙席', '塔比亚特', '纳夫特加奇萨兰',
    '圣塔菲联合', '巴里奥公园', '萨尔瓦多雷诺斯', '圣萨尔瓦多', '萨莫拉猛禽',
    '湖泊海盗', '阿巴丹炼油厂', '埃斯特格拉尔', '科尔多瓦学院U21', '贾伊克',
    // ↑ 真实数据里出现、且队名含 NBA/CBA 简称的队
    '山西财经大学',
  ],
  足球: [
    // 日职 / 韩职 / 泰超 / 其它亚洲
    '川崎前锋', '横滨水手', '浦和红钻', '鹿岛鹿角', '神户胜利船', '大阪樱花',
    '首尔FC', '蔚山现代', '全北现代', '浦项制铁', '城南FC', '水原FC',
    '武里南联', '曼谷联', '吉隆坡联', '淡滨泥', '狮城',
    // 巴甲 / 阿甲 / 墨超 等美洲
    '帕尔梅拉斯', '弗鲁米嫩塞', '圣保罗', '桑托斯', '弗拉门戈', '格雷米奥',
    '巴伊亚', '福塔雷萨', '科林蒂安', '圣保罗', '国际', '尤文图德',
    '蓝鹰', '老虎', '春华', '南美解放者',
    // ↑ 真实数据里出现、且队名含中超/五大联赛简称的队
    '大连足校', '天津圣德', '山东体彩', '浙江杭州女足', '尤文图斯马纳瓜', '里奥布兰科',
    '太原T&T', '越南煤矿', '河内女足', '胡志明市', '兄弟联盟', '阿巴哈尼',
    '春武里', '博乐大学', '雪兰莪', '阿德莱德城', '南墨尔本', '悉尼联',
    '斯图拉德', '南美联合', '莱卡特老虎', '法基拉普尔年轻人', 'MFS拉汉马特',
  ],
  电竞: [],
};

/**
 * 欧冠参赛队（判定「欧冠」用）。
 *
 * 五大联赛的球队默认都是欧冠参赛队，再补上常客俱乐部。
 */
const CHAMPIONS_LEAGUE_TEAMS: readonly string[] = [
  // 只取**欧洲**联赛的队。中超绝不能算进来 —— 否则「大连足校女足 vs 天津圣德女足」
  // 会因为两边都命中中国球队名而双双"是欧冠队"，整场被判成欧冠。
  ...(['英超', '西甲', '意甲', '德甲', '法甲'] as const).flatMap(
    (league) => (LEAGUE_TEAMS.足球?.[league] ?? []) as readonly string[],
  ),
  '阿贾克斯', '埃因霍温', '本菲卡', '波尔图', '萨尔茨堡', '哥本哈根',
  '顿涅茨克矿工', '顿涅茨克', '加拉塔萨雷', '费内巴切', '贝西克塔斯', '布鲁日',
  '奥林匹亚科斯', '帕纳辛奈科斯', '萨格勒布迪纳摩', '里加', '卢多戈茨',
  '卡拉古什', '伯尔尼年轻人', '凯尔特人足球俱乐部', '顿涅茨克',
];

/** 一个队名关键词。 */
interface LeagueKeyword {
  /** 队名关键词（按「包含」匹配） */
  keyword: string;
  /** 命中后判定的联赛 */
  league: string;
}

/** 分类 → 关键词表（已按关键词长度倒序排好，长关键词优先）。 */
const KEYWORD_INDEX: Readonly<Record<string, readonly LeagueKeyword[]>> = (() => {
  const result: Record<string, LeagueKeyword[]> = {};
  for (const category of ['篮球', '足球', '电竞']) {
    const list: LeagueKeyword[] = [];
    for (const [league, teams] of Object.entries(LEAGUE_TEAMS[category] ?? {})) {
      for (const team of teams) {
        list.push({ keyword: team, league });
      }
    }
    for (const team of FOREIGN_TEAMS[category] ?? []) {
      list.push({ keyword: team, league: OTHER_LEAGUE });
    }
    // 长关键词优先：避免「湖人」抢在「洛杉矶湖人」前面，也避免子串误命中
    list.sort((left, right) => right.keyword.length - left.keyword.length);
    result[category] = list;
  }
  return result;
})();

/**
 * 「非职业队」标记：队名里出现这些词，说明它不是我们追踪的联赛的成年职业队。
 *
 * 真实数据里踩过的坑：
 *   - 「大连足校女足」含「大连」→ 会被误判成中超，实际是体校队
 *   - 「山西财经大学」含「山西」→ 会被误判成 CBA，实际是校队
 *   - 「CB米拉U20」含 U20 → 青年队
 * 这些队一律归到「其他联赛」。
 */
/**
 * 篮球的「非 NBA/CBA 联赛」队名标记。
 *
 * ## 为什么必须有这张表
 * NBA/CBA 的队名表里存的是**短词**（`勇士`、`雷霆`、`开拓者`、`国王`、`老鹰`），
 * 因为上游只写「国王 vs 灰熊」这种短名。但亚洲/大洋洲联赛的球队名恰好含这些词：
 *   `信州勇士`（日本 B.League）、`川崎雷霆勇者`（日本）、`CSB开拓者`（菲律宾 PBA）
 * 于是这些比赛会被 `includes` 判成 NBA —— 实测就出过这个事故：
 * NBA 目录下全是日本、菲律宾、印尼的球。
 *
 * ## 规则
 * 命中这里任何一个标记 → **直接判「其他联赛」，不再往下判**。
 * 用「球队全名」而不是「城市」做标记，减少误伤（`东京`太泛，`东京电击`才准）。
 */
const BASKETBALL_FOREIGN_MARKERS: readonly string[] = [
  // 日本 B.League
  '宇都宫', '千叶喷射', '琉球黄金', '名古屋钻石', '大阪七福', '京都汉尼斯',
  '岛根须佐', '横滨海盗', '川崎雷霆', '信州勇士', '神户鹳鸟', '东京电击',
  '北海道雷神', '秋田北部', '富山松鸡', '新潟天鹅', '滋贺湖星', '三远新',
  '佐贺气球', '长崎维尔', '福冈新锐', '群马雷鹤', '茨城机器人', '青森',
  '山形飞龙', '福岛火绊', '西宫', '越谷', '仙台', '东京阳光', '涩谷',
  // 菲律宾 PBA / MPBL
  '玛布亚', 'CSB', '生力', '巴朗加', '马尼拉', '菲律宾',
  // 印尼 IBL
  '雅加达', '印尼', '孟加拉', '太平洋凯撒',
  // 韩国 KBL
  '首尔SK', '安养', '蔚山现代', '昌原', '原州', '釜山KCC', '大邱', '高阳', '水原',
  // 中国台北 PLG / T1
  '台北富邦', '新北国王', '桃园领航', '新竹攻城', '高雄海神', '台新梦想',
  // 澳洲 NBL
  '悉尼国王', '墨尔本联', '珀斯野猫', '布里斯班', '凯恩斯', '伊拉瓦拉',
  '塔斯马尼亚', '阿德莱德', '东南墨尔本',
];

const RESERVE_MARKERS: readonly string[] = [
  '足校', '财经', '大学', '学院', '学校', '体彩', '青年队', '青年', '预备',
  'U19', 'U20', 'U21', 'U22', 'U23', 'U25',
];

/**
 * 一个队名推断出来的信息。
 */
interface TeamMatch {
  /**
   * 命中的**具体**联赛（如 `NBA` / `英超`）。
   *
   * 为 `undefined` 表示这个队名要么根本不认识，要么明确属于「其他联赛」。
   */
  specific?: string;
  /**
   * 命中「其他联赛」关键词的最长长度（0 表示没命中）。
   *
   * 它的作用是**压掉短关键词造成的子串误命中**：澳洲 NBL 的「伊拉瓦拉老鹰」
   * 里含有 NBA 的「老鹰」，若不比较长度，这支队会被误判成 NBA。
   */
  otherLength: number;
}

/**
 * 拆出比赛双方（上游用 ` vs ` 分隔）。
 *
 * @param title 赛事标题，如 `湖人 vs 勇士`
 * @return 队名数组（没有分隔符时就是整个标题）
 */
function splitTeams(title: string): string[] {
  return title
    .split(/\s*vs\.?\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * 推断一个队名属于哪些联赛。
 *
 * @param category 分类（足球 / 篮球 / 电竞）
 * @param team 队名
 * @return 队名匹配结果
 */
function matchTeam(category: string, team: string): TeamMatch {
  const index = KEYWORD_INDEX[category] ?? [];
  let specific: string | undefined;
  let specificLength = 0;
  let otherLength = 0;

  for (const entry of index) {
    if (!team.includes(entry.keyword)) {
      continue;
    }
    if (entry.league === OTHER_LEAGUE) {
      if (entry.keyword.length > otherLength) {
        otherLength = entry.keyword.length;
      }
    } else if (entry.keyword.length > specificLength) {
      specificLength = entry.keyword.length;
      specific = entry.league;
    }
  }

  // 队名带「足校 / 财经 / U20」这类标记 → 肯定不是职业队，一律归「其他联赛」。
  // 这里**不看长度**：`大连足校女足` 里「足校」和「大连」都是 2 个字，
  // 按长度比会打平，结果保留「中超」——所以标记命中就直接作废具体联赛。
  const isReserveTeam = RESERVE_MARKERS.some((marker) => team.includes(marker));

  // 篮球：命中亚洲/大洋洲联赛的队名标记 → 直接归「其他联赛」。
  // 这条必须在长度比较之前 —— `信州勇士` 里「勇士」(2 字，NBA) 和「信州勇士」(4 字)
  // 都能命中，但真正的问题是它压根不是 NBA 球队，跟关键词长短无关。
  const isForeignBasketball =
    category === '篮球' && BASKETBALL_FOREIGN_MARKERS.some((marker) => team.includes(marker));

  // 「其他联赛」的关键词更长 → 这个队确实不属于我们追踪的联赛，
  // 之前那个短关键词命中是子串误命中，作废。
  if (isForeignBasketball || isReserveTeam || otherLength > specificLength) {
    specific = undefined;
  }

  return { ...(specific === undefined ? {} : { specific }), otherLength };
}

/**
 * 队名命中的关键词（调试与测试用）。
 *
 * 用来排查「短关键词误命中」：比如日本 B.League 的「兰实公牛」里含 NBA 的
 * 「公牛」，若映射表里没有「兰实公牛」这个更长的条目，这场比赛就会被误判成 NBA。
 *
 * @param category 分类（足球 / 篮球 / 电竞）
 * @param team 队名
 * @return 命中的关键词（长的在前）
 */
export function matchedKeywords(category: string, team: string): string[] {
  const index = KEYWORD_INDEX[category] ?? [];
  const hits: string[] = [];
  for (const entry of index) {
    if (team.includes(entry.keyword)) {
      hits.push(entry.keyword);
    }
  }
  return hits.sort((left, right) => right.length - left.length);
}

/**
 * 队名是否属于欧冠参赛队（判定「欧冠」用）。
 *
 * @param team 队名
 * @return true 表示欧冠参赛队
 */
function isUclTeam(team: string): boolean {
  return CHAMPIONS_LEAGUE_TEAMS.some((name) => team.includes(name));
}

/**
 * 推断一场赛事属于哪个联赛。
 *
 * 判定顺序：
 *   1. 两边队名命中**同一个**具体联赛 → 就是它（例如「曼联 vs 利物浦」→英超）。
 *   2. 两边都是欧冠参赛队但国内联赛不同 → `欧冠`（例如「皇家马德里 vs 曼城」）。
 *   3. 任何一边明确命中了「其他联赛」的队名 → `其他联赛`
 *      （例如「蜜蜂 vs 太阳」：蜜蜂是澳洲 NBL 队，不能因为对面叫「太阳」就判成 NBA）。
 *   4. 一边已知具体联赛、另一边不认识 → 取已知那个（例如「湖人 vs 某野球队」→NBA）。
 *   5. 跨联盟且两边都是已知联赛 → 取第一个（例如 NBA vs CBA → NBA）。
 *   6. 都不认识 → `其他联赛`（电竞统一 `电竞`）。
 *
 * @param category 分类（足球 / 篮球 / 电竞）
 * @param title 赛事标题，如 `雷霆 vs 掘金`
 * @return 联赛名
 */
export function detectLeague(category: string, title: string): string {
  if (category === '电竞') {
    // 电竞按战队名推项目（上游只给队名，不给赛事）
    return detectGame(title);
  }
  const teams = splitTeams(title);
  if (teams.length === 0) {
    return OTHER_LEAGUE;
  }

  const left = matchTeam(category, teams[0]);
  const right = teams.length > 1 ? matchTeam(category, teams[1]) : undefined;

  if (right === undefined) {
    return left.specific ?? OTHER_LEAGUE;
  }

  // 1) 两边同一个具体联赛
  if (left.specific !== undefined && left.specific === right.specific) {
    return left.specific;
  }
  // 2) 两边都是欧冠参赛队（国内联赛不同或一方未知）→ 欧冠
  if (isUclTeam(teams[0]) && isUclTeam(teams[1])) {
    return '欧冠';
  }
  // 3) 任何一边明确属于「其他联赛」→ 其他联赛
  if (left.otherLength > 0 || right.otherLength > 0) {
    return OTHER_LEAGUE;
  }
  // 4) 一边已知 → 取它
  if (left.specific !== undefined) {
    return left.specific;
  }
  if (right.specific !== undefined) {
    return right.specific;
  }
  // 5) 全不认识
  return OTHER_LEAGUE;
}

/**
 * 联赛在展示顺序里的位置（越小越靠前）。
 *
 * @param category 分类
 * @param league 联赛名
 * @return 序号；不在 `LEAGUE_ORDER` 里的排到所有已知联赛之后
 */
export function leagueRank(category: string, league: string): number {
  const order = LEAGUE_ORDER[category] ?? [];
  const index = order.indexOf(league);
  return index < 0 ? order.length : index;
}

/**
 * 平铺模式下联赛的展示顺序（越小越靠前）。
 *
 * @param league 联赛名
 * @return 序号；未知的排在已知之后、兜底之前
 */
export function flatLeagueRank(league: string): number {
  const index = FLAT_LEAGUE_ORDER.indexOf(league);
  if (index >= 0) {
    return index;
  }
  // 电竞项目走 gameRank 兜底
  if (GAME_ORDER.includes(league)) {
    return FLAT_LEAGUE_ORDER.indexOf('英雄联盟') + gameRank(league);
  }
  return FLAT_LEAGUE_ORDER.length;
}
