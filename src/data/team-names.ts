/**
 * @file 中文队名 → 英文关键词（给第三方赛程匹配用）。
 *
 * 为什么用**英文关键词**而不是完整队名：TheSportsDB 的写法会变
 * （`Sacramento Kings` / `Kings` / 带城市前缀或缩写），精确相等很容易漏。
 * 只留最能区分的一个词（`lakers` / `warriors`），用「包含」匹配，稳得多。
 *
 * 覆盖范围：**只收大联赛**（用户拍板「只给大联赛补时间」）。
 * 认不出的队不填时间，不影响播放 —— 宁可没时间，也不要错时间。
 */

/**
 * 分类 → { 中文关键词 → 英文特征词 }。
 *
 * 中文关键词同样按「包含」匹配，所以 `洛杉矶湖人` 里的 `湖人` 能命中。
 */
export const TEAM_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  篮球: {
    // NBA 30 队
    老鹰: 'hawks',
    凯尔特人: 'celtics',
    篮网: 'nets',
    黄蜂: 'hornets',
    公牛: 'bulls',
    骑士: 'cavaliers',
    独行侠: 'mavericks',
    小牛: 'mavericks',
    掘金: 'nuggets',
    活塞: 'pistons',
    勇士: 'warriors',
    火箭: 'rockets',
    步行者: 'pacers',
    快船: 'clippers',
    湖人: 'lakers',
    灰熊: 'grizzlies',
    热火: 'heat',
    雄鹿: 'bucks',
    森林狼: 'timberwolves',
    鹈鹕: 'pelicans',
    尼克斯: 'knicks',
    雷霆: 'thunder',
    魔术: 'magic',
    '76人': '76ers',
    太阳: 'suns',
    开拓者: 'trail blazers',
    国王: 'kings',
    马刺: 'spurs',
    猛龙: 'raptors',
    爵士: 'jazz',
    奇才: 'wizards',
    巫师: 'wizards',
    // CBA 20 队
    // 上游常只写城市（`上海 vs 广东`），所以城市简称也得收一份。
    // 对不上就只是没时间，不会错标，安全。
    广东宏远: 'guangdong',
    宏远: 'guangdong',
    东莞大益: 'guangdong',
    辽宁本钢: 'liaoning',
    本钢: 'liaoning',
    北京首钢: 'beijing ducks',
    首钢: 'beijing ducks',
    浙江稠州: 'zhejiang golden bulls',
    稠州: 'zhejiang golden bulls',
    浙江广厦: 'zhejiang lions',
    广厦: 'zhejiang lions',
    深圳马可波罗: 'shenzhen leopards',
    马可波罗: 'shenzhen leopards',
    深圳新世纪: 'shenzhen leopards',
    上海久事: 'shanghai sharks',
    久事: 'shanghai sharks',
    上海哔哩哔哩: 'shanghai sharks',
    新疆伊力特: 'xinjiang flying tigers',
    伊力特: 'xinjiang flying tigers',
    江苏肯帝亚: 'jiangsu dragons',
    肯帝亚: 'jiangsu dragons',
    山东高速: 'shandong hi-speed',
    北京北控: 'beijing royal fighters',
    北控: 'beijing royal fighters',
    天津先行者: 'tianjin pioneers',
    先行者: 'tianjin pioneers',
    广州龙狮: 'guangzhou loong lions',
    龙狮: 'guangzhou loong lions',
    山西汾酒: 'shanxi loongs',
    汾酒: 'shanxi loongs',
    吉林九台农商: 'jilin northeast tigers',
    九台农商: 'jilin northeast tigers',
    八一南昌: 'bayi rockets',
    // 城市简称（上游只写城市时用）
    上海: 'shanghai sharks',
    广东: 'guangdong',
    辽宁: 'liaoning',
    浙江: 'zhejiang',
    深圳: 'shenzhen',
    山东: 'shandong',
    江苏: 'jiangsu',
    天津: 'tianjin',
    广州: 'guangzhou',
    山西: 'shanxi',
    新疆: 'xinjiang',
    青岛: 'qingdao',
    福建: 'fujian',
    四川: 'sichuan',
    宁波: 'ningbo',
    吉林: 'jilin',
    同曦: 'tongxi',
  },
  足球: {
    // 英超
    阿森纳: 'arsenal',
    利物浦: 'liverpool',
    曼城: 'manchester city',
    曼联: 'manchester united',
    切尔西: 'chelsea',
    热刺: 'tottenham',
    托特纳姆: 'tottenham',
    纽卡斯尔: 'newcastle',
    阿斯顿维拉: 'aston villa',
    维拉: 'aston villa',
    布莱顿: 'brighton',
    西汉姆: 'west ham',
    埃弗顿: 'everton',
    富勒姆: 'fulham',
    狼队: 'wolves',
    水晶宫: 'crystal palace',
    诺丁汉森林: 'nottingham',
    利兹联: 'leeds',
    莱斯特城: 'leicester',
    南安普顿: 'southampton',
    伯恩利: 'burnley',
    布伦特福德: 'brentford',
    // 西甲
    皇家马德里: 'real madrid',
    皇马: 'real madrid',
    巴塞罗那: 'barcelona',
    巴萨: 'barcelona',
    马德里竞技: 'atletico madrid',
    马竞: 'atletico madrid',
    塞维利亚: 'sevilla',
    皇家社会: 'real sociedad',
    毕尔巴鄂: 'athletic',
    贝蒂斯: 'betis',
    比利亚雷亚尔: 'villarreal',
    瓦伦西亚: 'valencia',
    赫塔菲: 'getafe',
    奥萨苏纳: 'osasuna',
    塞尔塔: 'celta',
    西班牙人: 'espanyol',
    马略卡: 'mallorca',
    赫罗纳: 'girona',
    巴列卡诺: 'rayo',
    // 意甲
    国际米兰: 'inter',
    国米: 'inter',
    AC米兰: 'ac milan',
    米兰: 'milan',
    尤文图斯: 'juventus',
    尤文: 'juventus',
    那不勒斯: 'napoli',
    罗马: 'roma',
    拉齐奥: 'lazio',
    亚特兰大: 'atalanta',
    佛罗伦萨: 'fiorentina',
    都灵: 'torino',
    博洛尼亚: 'bologna',
    乌迪内斯: 'udinese',
    维罗纳: 'verona',
    莱切: 'lecce',
    热那亚: 'genoa',
    桑普多利亚: 'sampdoria',
    卡利亚里: 'cagliari',
    蒙扎: 'monza',
    恩波利: 'empoli',
    // 德甲
    拜仁: 'bayern',
    多特蒙德: 'dortmund',
    勒沃库森: 'leverkusen',
    莱比锡: 'leipzig',
    法兰克福: 'frankfurt',
    沃尔夫斯堡: 'wolfsburg',
    门兴: 'gladbach',
    弗赖堡: 'freiburg',
    斯图加特: 'stuttgart',
    不莱梅: 'werder',
    柏林联合: 'union berlin',
    美因茨: 'mainz',
    奥格斯堡: 'augsburg',
    霍芬海姆: 'hoffenheim',
    波鸿: 'bochum',
    科隆: 'koln',
    // 法甲
    巴黎圣日耳曼: 'paris saint',
    大巴黎: 'paris saint',
    摩纳哥: 'monaco',
    马赛: 'marseille',
    里昂: 'lyon',
    里尔: 'lille',
    尼斯: 'nice',
    雷恩: 'rennes',
    斯特拉斯堡: 'strasbourg',
    朗斯: 'lens',
    南特: 'nantes',
    蒙彼利埃: 'montpellier',
    图卢兹: 'toulouse',
    布雷斯特: 'brest',
    // 中超
    上海海港: 'shanghai port',
    上港: 'shanghai port',
    上海申花: 'shanghai shenhua',
    申花: 'shanghai shenhua',
    北京国安: 'beijing guoan',
    山东泰山: 'shandong taishan',
    浙江队: 'zhejiang',
    武汉三镇: 'wuhan three towns',
    天津津门虎: 'tianjin jinmen',
    河南队: 'henan',
    成都蓉城: 'chengdu rongcheng',
    大连人: 'dalian',
    长春亚泰: 'changchun',
    青岛海牛: 'qingdao',
    梅州客家: 'meizhou',
    深圳新鹏城: 'shenzhen peng city',
    沧州雄狮: 'cangzhou',
    南通支云: 'nantong',
    青岛西海岸: 'qingdao west coast',
  },
};

/**
 * 把中文队名翻成「英文特征词」。
 *
 * 按中文关键词长度倒序匹配（`上海海港` 优于 `上海`），命中即返回。
 *
 * @param category 分类（篮球 / 足球 / 电竞）
 * @param team 中文队名
 * @return 英文特征词；认不出返回空串
 */
export function toEnglishKeyword(category: string, team: string): string {
  const table = TEAM_ALIASES[category];
  if (table === undefined) {
    return '';
  }
  const keys = Object.keys(table).sort((left, right) => right.length - left.length);
  for (const key of keys) {
    if (team.includes(key)) {
      return table[key] ?? '';
    }
  }
  return '';
}
