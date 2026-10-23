/**
 * @file wudaliansai 赛事聚合源单测：地址改写、标题拆分、过滤与排序、局域网地址闸门。
 *
 * 重点钉住三件事：
 *   1. 产物里**永远不能出现公网地址**（文件是公开的）
 *   2. 回环地址必须被改写成对外基址，否则电视端播不了
 *   3. 公告条目被剔除、同场多线路被合并
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  compareMatches,
  fetchLiveMatches,
  isPrivateIpv4,
  parseLiveM3u,
  resolvePublicBase,
  resolveServiceBase,
  rewriteOrigin,
  splitTitle,
  toStatus,
  type LiveMatch,
} from '../src/sources/wudaliansai';
import { renderLiveM3u, renderLiveTxt, emitLive } from '../src/emit/live';
import { detectLeague, leagueRank, OTHER_LEAGUE } from '../src/data/live-leagues';

/** 一份贴近真实产物的样本（含公告、完场、未开赛、多线路）。 */
const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-name="注意事项" tvg-logo="https://cdn.jsdelivr.net/gh/jkwu5472/first/notice.jpg" group-title="注意事项",注意事项
https://cdn.jsdelivr.net/gh/jkwu5472/first/media.m3u8
#EXTINF:-1 tvg-name="湖人 vs 勇士|赛场原声" tvg-logo="http://logo/lakers.png" group-title="篮球",湖人 vs 勇士|赛场原声
http://127.0.0.1:18765/play/aaa
#EXTINF:-1 tvg-name="湖人 vs 勇士|高清" tvg-logo="http://logo/lakers.png" group-title="篮球",湖人 vs 勇士|高清
http://127.0.0.1:18765/play/bbb
#EXTINF:-1 tvg-name="灰熊 vs 爵士|完场" tvg-logo="http://logo/grizz.png" group-title="篮球",灰熊 vs 爵士|完场
http://127.0.0.1:18765/play/ccc
#EXTINF:-1 tvg-name="帕尔梅拉斯 vs 弗鲁米嫩塞|完场" tvg-logo="http://logo/pal.png" group-title="足球",帕尔梅拉斯 vs 弗鲁米嫩塞|完场
http://127.0.0.1:18765/play/ddd
#EXTINF:-1 tvg-name="Metizport vs Genone|赛场原声" tvg-logo="http://logo/met.png" group-title="电竞",Metizport vs Genone|赛场原声
http://127.0.0.1:18765/play/eee
`;

const BASE = 'http://192.168.1.7:18765';

describe('splitTitle / toStatus', () => {
  it('拆出赛事名与后缀', () => {
    expect(splitTitle('湖人 vs 勇士|高清')).toEqual({ title: '湖人 vs 勇士', suffix: '高清' });
    expect(splitTitle('湖人 vs 勇士')).toEqual({ title: '湖人 vs 勇士', suffix: '' });
  });

  it('只有状态后缀算非直播，线路后缀算直播中', () => {
    expect(toStatus('完场')).toBe('ended');
    expect(toStatus('未开赛')).toBe('upcoming');
    expect(toStatus('暂无直播')).toBe('unavailable');
    expect(toStatus('高清')).toBe('live');
    expect(toStatus('赛场原声')).toBe('live');
    expect(toStatus('')).toBe('live');
  });
});

describe('isPrivateIpv4', () => {
  it('认局域网段', () => {
    for (const ip of ['192.168.1.7', '10.0.0.5', '172.16.0.1', '172.31.255.254', '169.254.1.1']) {
      expect(isPrivateIpv4(ip)).toBe(true);
    }
  });

  it('拒绝公网与越界', () => {
    for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '1.2.3', 'a.b.c.d']) {
      expect(isPrivateIpv4(ip)).toBe(false);
    }
  });
});

describe('resolveServiceBase', () => {
  it('环境变量优先，并去掉末尾斜杠', () => {
    expect(resolveServiceBase({ WUDALIANSAI_BASE_URL: 'http://10.0.0.2:18765/' })).toBe('http://10.0.0.2:18765');
  });

  it('缺省落到本机 18765', () => {
    expect(resolveServiceBase({})).toBe('http://127.0.0.1:18765');
  });
});

describe('resolvePublicBase（产物发布前的公网闸门）', () => {
  it('优先取环境变量', () => {
    const out = resolvePublicBase({
      env: { WUDALIANSAI_PUBLIC_BASE: 'http://box.local:18765' },
      interfaces: {},
    });
    expect(out).toEqual({ base: 'http://box.local:18765', source: 'env' });
  });

  it('公网 IP 字面量被拒绝，改走局域网自动探测', () => {
    const out = resolvePublicBase({
      env: { WUDALIANSAI_PUBLIC_BASE: 'http://203.0.113.9:18765' },
      interfaces: { wlan0: [{ address: '192.168.1.7', family: 'IPv4', internal: false }] },
    });
    expect(out.base).toBe('http://192.168.1.7:18765');
    expect(out.source).toBe('lan');
  });

  it('公网 IP 且没有局域网可用时退回回环（绝不写公网）', () => {
    const out = resolvePublicBase({
      env: { WUDALIANSAI_PUBLIC_BASE: 'http://8.8.8.8:18765' },
      interfaces: {},
    });
    expect(out.base).toBe('http://127.0.0.1:18765');
    expect(out.source).toBe('loopback');
  });

  it('自动探测时只认局域网 IPv4，公网网卡被忽略', () => {
    const out = resolvePublicBase({
      env: {},
      interfaces: {
        wlan0: [
          { address: '192.168.1.7', family: 'IPv4', internal: false },
          { address: 'fe80::1', family: 'IPv6', internal: false },
        ],
        eth0: [{ address: '203.0.113.9', family: 'IPv4', internal: false }],
      },
    });
    expect(out.base).toBe('http://192.168.1.7:18765');
    expect(out.source).toBe('lan');
  });

  it('无线网卡优先于有线网卡（手机上是 wlan0）', () => {
    const out = resolvePublicBase({
      env: {},
      interfaces: {
        eth0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
        wlan0: [{ address: '192.168.1.7', family: 'IPv4', internal: false }],
      },
    });
    expect(out.base).toBe('http://192.168.1.7:18765');
  });

  it('蜂窝网卡被整体排除（10.x 看着像私网，电视其实路由不到）', () => {
    const out = resolvePublicBase({
      env: {},
      interfaces: {
        ccmni1: [{ address: '10.2.6.86', family: 'IPv4', internal: false }],
      },
    });
    expect(out.base).toBe('http://127.0.0.1:18765');
    expect(out.source).toBe('loopback');
    expect(out.warning).toContain('蜂窝');
  });

  it('手机热点（ap0）优先于蜂窝网卡', () => {
    const out = resolvePublicBase({
      env: {},
      interfaces: {
        ccmni1: [{ address: '10.2.6.86', family: 'IPv4', internal: false }],
        ap0: [{ address: '192.168.43.106', family: 'IPv4', internal: false }],
      },
    });
    expect(out.base).toBe('http://192.168.43.106:18765');
    expect(out.source).toBe('lan');
  });

  it('Wi-Fi 客户端地址优先于热点地址', () => {
    const out = resolvePublicBase({
      env: {},
      interfaces: {
        ap0: [{ address: '192.168.43.106', family: 'IPv4', internal: false }],
        wlan0: [{ address: '192.168.1.7', family: 'IPv4', internal: false }],
      },
    });
    expect(out.base).toBe('http://192.168.1.7:18765');
  });

  it('没有可用的局域网地址时退回回环，并给出提醒', () => {
    const out = resolvePublicBase({
      env: {},
      interfaces: { eth0: [{ address: '203.0.113.9', family: 'IPv4', internal: false }] },
    });
    expect(out.base).toBe('http://127.0.0.1:18765');
    expect(out.source).toBe('loopback');
    expect(out.warning).toBeDefined();
  });
});

describe('rewriteOrigin', () => {
  it('回环地址被改写成对外基址', () => {
    expect(rewriteOrigin('http://127.0.0.1:18765/play/abc', BASE)).toBe(`${BASE}/play/abc`);
    expect(rewriteOrigin('http://localhost:18765/play/abc?x=1', BASE)).toBe(`${BASE}/play/abc?x=1`);
  });

  it('已经是真实地址时原样保留', () => {
    const real = 'https://pullgz721.qmuiw.com/live/sd-2-3925763.m3u8?auth_key=1';
    expect(rewriteOrigin(real, BASE)).toBe(real);
  });
});

describe('parseLiveM3u', () => {
  it('剔除公告条目', () => {
    const matches = parseLiveM3u(SAMPLE, BASE);
    expect(matches.some((match) => match.title === '注意事项')).toBe(false);
  });

  it('同场多线路合并成一条，线路按画质优先排序', () => {
    const matches = parseLiveM3u(SAMPLE, BASE);
    const lakers = matches.find((match) => match.title === '湖人 vs 勇士');
    expect(lakers).toBeDefined();
    expect(lakers?.variants.map((variant) => variant.line)).toEqual(['高清', '赛场原声']);
    expect(lakers?.status).toBe('live');
  });

  it('把播放地址改写成对外基址', () => {
    const matches = parseLiveM3u(SAMPLE, BASE);
    const lakers = matches.find((match) => match.title === '湖人 vs 勇士');
    expect(lakers?.variants.every((variant) => variant.url.startsWith(`${BASE}/play/`))).toBe(true);
  });

  it('完场/未开赛等状态被正确标记', () => {
    const matches = parseLiveM3u(SAMPLE, BASE);
    expect(matches.find((match) => match.title === '灰熊 vs 爵士')?.status).toBe('ended');
  });

  it('保留全部分类（含电竞），顺序为 足球 → 篮球 → 电竞', () => {
    const matches = parseLiveM3u(SAMPLE, BASE);
    const categories = [...new Set(matches.map((match) => match.category))];
    expect(categories).toEqual(['足球', '篮球', '电竞']);
  });

  it('直播中的场次排在完场之前', () => {
    const matches = parseLiveM3u(SAMPLE, BASE);
    const basketball = matches.filter((match) => match.category === '篮球');
    expect(basketball[0].status).toBe('live');
    expect(basketball[basketball.length - 1].status).toBe('ended');
  });

  it('compareMatches 对未知分类排在其后', () => {
    const make = (category: string): LiveMatch => ({
      category,
      league: '其他联赛',
      title: 'x',
      status: 'live',
      variants: [{ line: '', url: 'http://a' }],
    });
    expect(compareMatches(make('足球'), make('未知分类'))).toBeLessThan(0);
  });
});

describe('detectLeague（靠队名推断联赛）', () => {
  it('篮球：NBA 队名归 NBA', () => {
    expect(detectLeague('篮球', '雷霆 vs 掘金')).toBe('NBA');
    expect(detectLeague('篮球', '湖人 vs 勇士')).toBe('NBA');
    expect(detectLeague('篮球', '凯尔特人 vs 雄鹿')).toBe('NBA');
  });

  it('篮球：CBA 队名归 CBA', () => {
    expect(detectLeague('篮球', '广东宏远 vs 辽宁本钢')).toBe('CBA');
    expect(detectLeague('篮球', '浙江稠州 vs 深圳马可波罗')).toBe('CBA');
  });

  it('篮球：认不出来的队归其他联赛', () => {
    expect(detectLeague('篮球', '卡德 vs 耶鲁竞技')).toBe(OTHER_LEAGUE);
  });

  it('篮球：澳洲队名里含 NBA 简称时不能误判（蜜蜂 vs 太阳）', () => {
    // 「蜜蜂」是澳洲 NBL 队，「太阳」是 NBA 队 —— 不能因为对面叫「太阳」就判成 NBA
    expect(detectLeague('篮球', '蜜蜂 vs 太阳')).toBe(OTHER_LEAGUE);
    // 「伊拉瓦拉老鹰」含 NBA 的「老鹰」，长关键词必须压过短关键词
    expect(detectLeague('篮球', '伊拉瓦拉老鹰 vs 凯尔特人')).toBe(OTHER_LEAGUE);
  });

  it('篮球：日本 B.League 队名里含 NBA 简称时不能误判', () => {
    // 「东京太阳摇滚」含「太阳」、「兰实公牛」含「公牛」
    expect(detectLeague('篮球', '东京太阳摇滚 vs 凯尔特人')).toBe(OTHER_LEAGUE);
    expect(detectLeague('篮球', '兰实公牛 vs 雷霆')).toBe(OTHER_LEAGUE);
    expect(detectLeague('篮球', '大阪七福神 vs 东京太阳摇滚')).toBe(OTHER_LEAGUE);
  });

  it('校队/青年队不按职业联赛算（真实数据里踩过的坑）', () => {
    // 「大连足校女足」含「大连」、「山西财经大学」含「山西」
    expect(detectLeague('足球', '大连足校女足 vs 山西喜华女足')).toBe(OTHER_LEAGUE);
    expect(detectLeague('篮球', '山西财经大学 vs 广东宏远')).toBe(OTHER_LEAGUE);
    // U20 青年队
    expect(detectLeague('足球', 'CB米拉U20 vs 伊尤马U20')).toBe(OTHER_LEAGUE);
  });

  it('中超梯队仍算中超（不能被梯队规则误伤）', () => {
    expect(detectLeague('足球', '上海海港B队 vs 杭州临平吴越')).toBe('中超');
  });

  it('足球：五大联赛 + 中超 + 欧冠', () => {
    expect(detectLeague('足球', '曼联 vs 利物浦')).toBe('英超');
    expect(detectLeague('足球', '皇家马德里 vs 巴塞罗那')).toBe('西甲');
    expect(detectLeague('足球', '国际米兰 vs 尤文图斯')).toBe('意甲');
    expect(detectLeague('足球', '拜仁仁 vs 多特蒙德')).toBe('德甲');
    expect(detectLeague('足球', '巴黎圣日耳曼 vs 摩纳哥')).toBe('法甲');
    expect(detectLeague('足球', '山东泰山 vs 上海海港')).toBe('中超');
    expect(detectLeague('足球', '皇家马德里 vs 曼城')).toBe('欧冠');
  });

  it('足球：小联赛归其他联赛', () => {
    expect(detectLeague('足球', '弗拉门戈 vs 拉普拉塔大学生')).toBe(OTHER_LEAGUE);
  });

  it('电竞不细分', () => {
    expect(detectLeague('电竞', 'Metizport vs Genone')).toBe('电竞');
  });

  it('同分类内联赛顺序固定，「其他联赛」最后', () => {
    expect(leagueRank('篮球', 'NBA')).toBeLessThan(leagueRank('篮球', 'CBA'));
    expect(leagueRank('篮球', 'CBA')).toBeLessThan(leagueRank('篮球', OTHER_LEAGUE));
    expect(leagueRank('足球', '英超')).toBeLessThan(leagueRank('足球', '欧冠'));
    expect(leagueRank('足球', '欧冠')).toBeLessThan(leagueRank('足球', OTHER_LEAGUE));
  });
});

describe('renderLiveTxt / renderLiveM3u', () => {
  const matches = parseLiveM3u(SAMPLE, BASE);

  it('分组名是「分类|联赛」，线路不再占分组位', () => {
    const text = renderLiveTxt(matches);
    const groups = text
      .split('\n')
      .filter((line) => line.endsWith(',#genre#'))
      .map((line) => line.slice(0, -',#genre#'.length));
    expect(groups).toContain('篮球|NBA');
    expect(groups).toContain('足球|其他联赛');
    expect(groups).toContain('电竞|电竞');
    // 旧格式（把线路当分组）不该再出现
    expect(groups.some((group) => group.endsWith('|高清'))).toBe(false);
    expect(groups.some((group) => group.endsWith('|赛场原声'))).toBe(false);
  });

  it('条目名统一带状态前缀，线路名进括号', () => {
    const text = renderLiveTxt(matches);
    expect(text).toContain('[直播中] 湖人 vs 勇士 (赛场原声)');
    expect(text).toContain('[直播中] 湖人 vs 勇士 (高清)');
    expect(text).toContain('[已结束] 灰熊 vs 爵士');
  });

  it('无线路名时不出现空括号', () => {
    const text = renderLiveTxt(matches);
    expect(text).not.toContain('()');
  });

  it('M3U 的 group-title 也是分类|联赛', () => {
    const m3u = renderLiveM3u(matches);
    expect(m3u).toContain('group-title="篮球|NBA"');
    expect(m3u).not.toContain('group-title="篮球|高清"');
  });

  it('TXT 无 BOM、只有 LF、末尾单个换行', () => {
    const text = renderLiveTxt(matches);
    expect(text.startsWith('\uFEFF')).toBe(false);
    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('TXT 分组头是「分类|联赛,#genre#」', () => {
    const lines = renderLiveTxt(matches).split('\n');
    expect(lines).toContain('篮球|NBA,#genre#');
    expect(lines).toContain('足球|其他联赛,#genre#');
    expect(lines).toContain('电竞|电竞,#genre#');
  });

  it('TXT 频道行是「名条,地址」，名条带状态前缀与线路名', () => {
    const lines = renderLiveTxt(matches).split('\n');
    expect(lines).toContain(`[直播中] 湖人 vs 勇士 (高清),${BASE}/play/bbb`);
    expect(lines).toContain(`[已结束] 灰熊 vs 爵士,${BASE}/play/ccc`);
  });

  it('M3U 带 group-title 与台标', () => {
    const text = renderLiveM3u(matches);
    expect(text.startsWith('#EXTM3U')).toBe(true);
    expect(text).toContain('group-title="篮球|NBA"');
    expect(text).toContain('tvg-logo="http://logo/lakers.png"');
  });
});

describe('fetchLiveMatches（服务不可用时静默跳过）', () => {
  it('连接失败返回 ok:false 而不抛错', async () => {
    const failing: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));
    const outcome = await fetchLiveMatches({ fetchImpl: failing, env: {} });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeDefined();
  });

  it('HTTP 非 2xx 返回 ok:false', async () => {
    const failing: typeof fetch = () =>
      Promise.resolve(new Response('nope', { status: 502 }));
    const outcome = await fetchLiveMatches({ fetchImpl: failing, env: {} });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('HTTP 502');
  });

  it('正常响应时解析出赛事并改写地址', async () => {
    const ok: typeof fetch = () => Promise.resolve(new Response(SAMPLE, { status: 200 }));
    const outcome = await fetchLiveMatches({
      fetchImpl: ok,
      env: { WUDALIANSAI_PUBLIC_BASE: BASE },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.matches.length).toBeGreaterThan(0);
    expect(outcome.matches.every((match) => match.variants.every((v) => v.url.startsWith(BASE)))).toBe(true);
  });
});

describe('emitLive（不拿回环地址覆盖线上可用清单）', () => {
  it('只有回环地址时不写产物', async () => {
    const ok: typeof fetch = () => Promise.resolve(new Response(SAMPLE, { status: 200 }));
    const outcome = await emitLive({
      fetchImpl: ok,
      env: { WUDALIANSAI_PUBLIC_BASE: 'http://127.0.0.1:18765' },
      txtPath: `${tmpdir()}/live-loopback.txt`,
      m3uPath: `${tmpdir()}/live-loopback.m3u`,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('局域网地址');
    expect(existsSync(`${tmpdir()}/live-loopback.txt`)).toBe(false);
  });

  it('有局域网地址时正常写出', async () => {
    const ok: typeof fetch = () => Promise.resolve(new Response(SAMPLE, { status: 200 }));
    const txtPath = `${tmpdir()}/live-lan.txt`;
    const outcome = await emitLive({
      fetchImpl: ok,
      env: { WUDALIANSAI_PUBLIC_BASE: BASE },
      txtPath,
      m3uPath: `${tmpdir()}/live-lan.m3u`,
    });
    expect(outcome.ok).toBe(true);
    expect(existsSync(txtPath)).toBe(true);
    expect(readFileSync(txtPath, 'utf8')).toContain(`${BASE}/play/bbb`);
    rmSync(txtPath, { force: true });
    rmSync(`${tmpdir()}/live-lan.m3u`, { force: true });
  });
});