/**
 * @file 电竞项目识别（上游只有战队名，没有任何赛事/游戏字段）。
 *
 * 上游 `group-title="电竞"` 的条目形如 `9z vs TYLOO`、`HLE vs IG`，
 * **不含赛事名**，所以只能靠**战队名**反推是哪个游戏。
 *
 * 注意局限：不少战队跨项目（Liquid / NAVI / G2 / Spirit 既打 CS 也打 DOTA2），
 * 这里按各队**最具代表性**的项目归类，认不出的统一落 `其他游戏`。
 * 宁可少判，不要乱判 —— 判错比不判更烦人。
 */

/** 电竞兜底分组名。 */
export const OTHER_GAME = '其他游戏';

/** 电竞项目的展示顺序。 */
export const GAME_ORDER: readonly string[] = [
  '英雄联盟',
  'CS2',
  'DOTA2',
  '王者荣耀',
  OTHER_GAME,
];

/**
 * 战队关键词 → 游戏。
 *
 * 只收**归属明确**的队；跨项目的（Liquid、NAVI、G2、Spirit 等）按主力项目放，
 * 但优先匹配更长的关键词（如 `spirit` 归 DOTA2，`team spirit` 也归 DOTA2）。
 */
const TEAM_GAMES: Readonly<Record<string, readonly string[]>> = {
  英雄联盟: [
    // LPL / LCK / LEC / LCS 常见队
    't1', 'gen.g', 'geng', 'hanwha life', 'hle', 'dplus kia', 'dk', 'kt rolster',
    'bilibili gaming', 'blg', 'jd gaming', 'jdg', 'top esports', 'tes', 'weibo gaming',
    'wbg', 'lng', 'edg', 'rng', 'invictus gaming', 'ig', 'fpx', 'omg', 'up',
    'g2', 'fnatic', 'fnc', 'mad lions', 'movistar koi', 'mkoi', 'karmine corp', 'kc',
    'team vitality', 'giantx', 'sk gaming', 'rogue', 'excel', 'astralis',
    'cloud9', 'c9', 'team liquid', '100 thieves', 'flyquest', 'tsm',
    'lyon', 'shopify rebellion', 'dignitas', 'immortals',
    'psg talon', 'tln', 'gam esports', 'gam', 'team whalers', 'fukuoka softbank',
  ],
  CS2: [
    'tyloo', 'furia', 'paiN', 'imperial', 'mibr', '9z', 'legacy', 'navi',
    'natus vincere', 'faze', 'mouz', 'heroic', 'vitality', 'spirit',
    'complexity', 'col', 'virtus.pro', 'vp', 'astralis', 'big', '3dmax',
    'eternal fire', 'apeks', 'ence', 'gamerlegion', 'the mongolz', 'mongolz',
    'lynn vision', 'rare atom', 'lvg', 'wings up', 'nemiga', 'forze', 'b8',
    'fnatic rising', 'sangal', '9 pandas', '9pandas', 'betboom',
  ],
  DOTA2: [
    'psg.lgd', 'lgd', 'xtreme gaming', 'xg', 'azure ray', 'ar',
    'gaimin gladiators', 'gg', 'tundra', 'entity', 'talon', 'blacklist',
    'beastcoast', 'nouns', 'shopify', 'aurora', 'heroic dota', 'og',
    'team spirit', 'spirit', '9pandas', '9 pandas', 'virtus.pro',
  ],
  王者荣耀: [
    '成都ag', 'ag超玩会', '武汉estar', 'estar', '重庆狼队', '狼队', '佛山drg',
    '苏州ksg', 'ksg', '上海edg.m', '南京hero', 'hero久竞', '北京wb', 'wb',
    '济南rw', 'rw侠', '广州ttg', 'ttg', '西安we', 'we', '长沙tes', 'tes',
  ],
};

/** 战队关键词表，按长度倒序（长关键词优先，避免 `ig` 抢在 `invictus gaming` 前面）。 */
const KEYWORD_INDEX: ReadonlyArray<{ keyword: string; game: string }> = (() => {
  const list: Array<{ keyword: string; game: string }> = [];
  for (const [game, teams] of Object.entries(TEAM_GAMES)) {
    for (const team of teams) {
      list.push({ keyword: team.toLowerCase(), game });
    }
  }
  return list.sort((left, right) => right.keyword.length - left.keyword.length);
})();

/**
 * 把一个战队名归一化：转小写、去掉常见后缀噪音。
 *
 * @param team 战队名
 * @return 归一化结果
 */
function normalizeTeam(team: string): string {
  return team.trim().toLowerCase();
}

/**
 * 拆出对战双方（上游用 ` vs ` 分隔）。
 *
 * @param title 赛事标题，如 `9z vs TYLOO`
 * @return 战队名数组
 */
function splitTeams(title: string): string[] {
  return title
    .split(/\s*vs\.?\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * 判断一场电竞比赛属于哪个游戏。
 *
 * 判定顺序：两边同项目 → 该项目；否则取先认出的那个；都认不出 → `其他游戏`。
 *
 * @param title 赛事标题，如 `HLE vs IG`
 * @return 游戏名
 */
export function detectGame(title: string): string {
  const teams = splitTeams(title);
  if (teams.length === 0) {
    return OTHER_GAME;
  }

  const found: string[] = [];
  for (const team of teams) {
    const normalized = normalizeTeam(team);
    for (const entry of KEYWORD_INDEX) {
      if (normalized.includes(entry.keyword)) {
        found.push(entry.game);
        break;
      }
    }
  }

  if (found.length === 0) {
    return OTHER_GAME;
  }
  // 两边一致就用它
  if (found.every((game) => game === found[0])) {
    return found[0];
  }
  // 不一致时取第一个认出的（跨项目对战很少见，宁可给一个也不落其他）
  return found[0];
}

/**
 * 游戏在展示顺序里的位置。
 *
 * @param game 游戏名
 * @return 序号；未知的排最后
 */
export function gameRank(game: string): number {
  const index = GAME_ORDER.indexOf(game);
  return index < 0 ? GAME_ORDER.length : index;
}
