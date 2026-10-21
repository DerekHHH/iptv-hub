/**
 * @file 增量回归（需求 2）：港澳台英文台名 / 澳门 / 广东「南方」系频道的归一表。
 *
 * 背景：公开源里香港、澳门、台湾频道大量写成英文名（`Jade` / `Pearl` / `TDM Ou Mun`），
 * 规则表缺一条就会整条落到哈希 slug，表现为「同一个台重复出现 + 分错组」。
 */

import { describe, expect, it } from 'vitest';

import { CHANNEL_RULES } from '../src/data/channel-rules';
import { buildChannels, identifyChannel } from '../src/normalize/channelName';
import { makeStream } from '../src/parse/common';

/**
 * 取 slug（断言前确认非 null）。
 *
 * @param name 频道名
 * @return slug
 */
function slugOf(name: string): string {
  const identity = identifyChannel(name);
  expect(identity, name).not.toBeNull();
  return identity?.id ?? '';
}

describe('香港：英文台名必须认得出来', () => {
  it.each([
    ['Jade', 'tvb-jade'],
    ['TVB Jade', 'tvb-jade'],
    ['Pearl', 'tvb-pearl'],
    ['TVB News', 'tvb-news'],
    ['J2', 'j2'],
    ['ViuTV', 'viutv'],
    ['ViuTVsix', 'viutv-six'],
    ['HOY TV', 'hoy-tv'],
    ['RTHK TV 31', 'rthk-31'],
    ['RTHK TV 35', 'rthk-35'],
    ['Phoenix Chinese', 'phoenix-chinese'],
    ['Phoenix InfoNews', 'phoenix-info'],
    ['香港卫视', 'hkstv'],
  ])('%s → %s', (name, expected) => {
    expect(slugOf(name)).toBe(expected);
  });

  it('英文台名与中文台名落到同一个 slug（不会拆成两条）', () => {
    expect(slugOf('Jade')).toBe(slugOf('翡翠台'));
    expect(slugOf('無綫翡翠台')).toBe(slugOf('Jade'));
    expect(slugOf('Pearl')).toBe(slugOf('明珠台'));
    expect(slugOf('TVB News')).toBe(slugOf('無綫新聞台'));
    expect(slugOf('HOY TV')).toBe(slugOf('香港开电视'));
    expect(slugOf('Phoenix Chinese')).toBe(slugOf('凤凰卫视'));
  });

  it('港台 31~36 六条规则齐全，且各自独立', () => {
    const ids = ['31', '32', '33', '34', '35', '36'].map((no) => slugOf(`RTHK TV ${no}`));
    expect(ids).toEqual(['rthk-31', 'rthk-32', 'rthk-33', 'rthk-34', 'rthk-35', 'rthk-36']);
    expect(new Set(ids).size).toBe(6);
  });
});

describe('澳门：TDM / 莲花', () => {
  it.each([
    ['澳视澳门', 'tdm-oumun'],
    ['澳視澳門', 'tdm-oumun'],
    ['TDM Ou Mun', 'tdm-oumun'],
    ['TDM澳門', 'tdm-oumun'],
    ['澳视葡文', 'tdm-pm'],
    ['TDM Canal Macau', 'tdm-pm'],
    ['澳門蓮花衛視', 'lotus-macau'],
    ['Lotus Macau', 'lotus-macau'],
  ])('%s → %s', (name, expected) => {
    expect(slugOf(name)).toBe(expected);
  });

  it('澳视澳门 与 澳视葡文 是两个台，且都是港澳台', () => {
    expect(slugOf('澳视澳门')).not.toBe(slugOf('澳视葡文'));
    expect(identifyChannel('澳视澳门')?.group).toBe('港澳台');
    expect(identifyChannel('澳門蓮花衛視')?.group).toBe('港澳台');
  });
});

describe('台湾：补英文/繁体别名，不新建重复规则', () => {
  it.each([
    ['台視', 'ttv'],
    ['TTV', 'ttv'],
    ['中視', 'ctv-tw'],
    ['華視', 'cts'],
    ['公視', 'ptt'],
    ['民視', 'ftv-news'],
    ['TVBS Asia', 'tvbs-news'],
    ['中天新聞', 'cti-news'],
    ['三立新聞', 'set-news'],
    ['東森', 'ettv-news'],
    ['緯來', 'videoland'],
  ])('%s → %s', (name, expected) => {
    expect(slugOf(name)).toBe(expected);
  });

  it('繁体与简体命中同一条规则（同一个 slug）', () => {
    expect(slugOf('台視')).toBe(slugOf('台视'));
    expect(slugOf('民視')).toBe(slugOf('民视'));
    expect(slugOf('公視')).toBe(slugOf('公视'));
    expect(slugOf('三立新聞')).toBe(slugOf('三立新闻'));
  });
});

describe('广东：「南方」系频道（已更名的大湾区卫视）', () => {
  it('南方卫视 / TVS-2 都映射到大湾区卫视（2022 年已更名，公开源里没有南方卫视）', () => {
    expect(slugOf('南方卫视')).toBe('gd-bayarea');
    expect(slugOf('南方衛視')).toBe('gd-bayarea');
    expect(slugOf('TVS-2')).toBe('gd-bayarea');
    expect(slugOf('TVS2')).toBe('gd-bayarea');
    expect(slugOf('大湾区卫视')).toBe('gd-bayarea');
  });

  it('广东四条规则 id / name / group 全部正确', () => {
    expect(identifyChannel('大湾区卫视')?.id).toBe('gd-bayarea');
    expect(identifyChannel('大湾区卫视')?.name).toBe('大湾区卫视');
    expect(identifyChannel('大湾区卫视')?.group).toBe('广东');

    expect(identifyChannel('南方经济科教')?.id).toBe('gd-tvs1');
    expect(identifyChannel('TVS-1')?.id).toBe('gd-tvs1');
    expect(identifyChannel('TVS-1')?.group).toBe('广东');

    expect(identifyChannel('南方影视')?.id).toBe('gd-tvs4');
    expect(identifyChannel('TVS-4')?.id).toBe('gd-tvs4');
    expect(identifyChannel('TVS-4')?.group).toBe('广东');

    expect(identifyChannel('南方少儿')?.id).toBe('gd-tvs5');
    expect(identifyChannel('TVS-5')?.id).toBe('gd-tvs5');
    expect(identifyChannel('TVS-5')?.group).toBe('广东');
  });

  it('TVS-3 综艺频道已停播，规则表里不加（避免把空台当成常驻频道）', () => {
    expect(CHANNEL_RULES.some((rule) => rule.aliases.includes('TVS-3'))).toBe(false);
    expect(CHANNEL_RULES.some((rule) => rule.aliases.includes('TVS3'))).toBe(false);
  });

  it('广东卫视仍属卫视组，不会被「广东」规则抢走', () => {
    expect(identifyChannel('广东卫视')?.group).toBe('卫视');
  });

  it('南方卫视与 大湾区卫视 在 buildChannels 里合并成一个频道', () => {
    const channels = buildChannels([
      makeStream('http://a.local/bay.m3u8', '南方卫视', 'u1'),
      makeStream('http://a.local/bay2.m3u8', '大湾区卫视', 'u2'),
    ]);
    const bay = channels.filter((channel) => channel.id === 'gd-bayarea');
    expect(bay).toHaveLength(1);
    expect(bay[0]?.group).toBe('广东');
    expect(bay[0]?.streams).toHaveLength(2);
  });
});

describe('规则表自检', () => {
  it('关键频道 slug 唯一（没有两条规则抢同一个 id）', () => {
    const ids = CHANNEL_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('本次新增的港澳台/广东规则都在表里', () => {
    const ids = new Set(CHANNEL_RULES.map((rule) => rule.id));
    for (const id of [
      'tvb-jade', 'tvb-pearl', 'tvb-news', 'j2', 'viutv', 'viutv-six', 'hoy-tv',
      'rthk-31', 'rthk-32', 'rthk-33', 'rthk-34', 'rthk-35', 'rthk-36',
      'phoenix-chinese', 'phoenix-info', 'phoenix-hk', 'hkstv',
      'tdm-oumun', 'tdm-pm', 'lotus-macau',
      'gd-bayarea', 'gd-tvs1', 'gd-tvs4', 'gd-tvs5',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});
