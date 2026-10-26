/**
 * @file 赛程回填单测：时间解析、北京时间换算、队名匹配、名条格式。
 *
 * 这里钉住三件最容易出错的事：
 *   1. `strTimestamp` 是 **UTC 且不带 Z**，按本地时区解释会整体偏 8 小时
 *   2. 主客顺序不能假设一致（上游和赛程源经常反着写）
 *   3. 认不出的队必须**不填时间**，绝不能猜
 */

import { describe, expect, it } from 'vitest';

import { formatKickoff } from '../src/emit/live';
import {
  attachSchedule,
  beijingDate,
  findSchedule,
  inferStatus,
  parseTimestamp,
  type ScheduleEvent,
} from '../src/sources/schedule';
import { toEnglishKeyword } from '../src/data/team-names';
import type { LiveMatch } from '../src/sources/wudaliansai';

/** 构造一条赛程事件。 */
function makeEvent(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    league: 'NBA',
    homeEn: 'Oklahoma City Thunder',
    awayEn: 'Denver Nuggets',
    startAt: Date.parse('2026-10-26T01:00:00Z'),
    ended: false,
    ...overrides,
  };
}

describe('时间解析', () => {
  it('不带 Z 的时间戳按 UTC 解释', () => {
    expect(parseTimestamp('2026-10-26T01:00:00')).toBe(Date.parse('2026-10-26T01:00:00Z'));
  });

  it('带时区的时间戳照常解析', () => {
    expect(parseTimestamp('2026-10-26T09:00:00+08:00')).toBe(Date.parse('2026-10-26T01:00:00Z'));
  });

  it('非法值返回 undefined', () => {
    expect(parseTimestamp(undefined)).toBeUndefined();
    expect(parseTimestamp('not-a-date')).toBeUndefined();
  });

  it('北京日期按 UTC+8 算', () => {
    // 2026-10-26 01:00 UTC → 北京 10-26 09:00
    expect(beijingDate(Date.parse('2026-10-26T01:00:00Z'))).toBe('2026-10-26');
    // 2026-10-26 20:00 UTC → 北京 10-27 04:00，跨日
    expect(beijingDate(Date.parse('2026-10-26T20:00:00Z'))).toBe('2026-10-27');
  });
});

describe('名条时间格式', () => {
  const now = Date.parse('2026-10-26T04:00:00Z'); // 北京 12:00

  it('当天的只给时分', () => {
    expect(formatKickoff(Date.parse('2026-10-26T01:00:00Z'), now)).toBe('09:00');
  });

  it('跨日的补上日期', () => {
    expect(formatKickoff(Date.parse('2026-10-27T01:30:00Z'), now)).toBe('10-27 09:30');
  });
});

describe('队名映射', () => {
  it('中文队名翻成英文特征词', () => {
    expect(toEnglishKeyword('篮球', '雷霆')).toBe('thunder');
    expect(toEnglishKeyword('篮球', '洛杉矶湖人')).toBe('lakers');
    expect(toEnglishKeyword('足球', '曼联')).toBe('manchester united');
  });

  it('长关键词优先（上海海港 不会退化成 上海）', () => {
    expect(toEnglishKeyword('足球', '上海海港B队')).toBe('shanghai port');
  });

  it('认不出的队返回空串', () => {
    expect(toEnglishKeyword('篮球', '卡德')).toBe('');
  });
});

describe('赛程匹配', () => {
  const events = [makeEvent()];

  it('命中同一场比赛', () => {
    const hit = findSchedule('篮球', '雷霆 vs 掘金', events);
    expect(hit?.homeEn).toBe('Oklahoma City Thunder');
  });

  it('主客顺序反着写也能命中', () => {
    const hit = findSchedule('篮球', '掘金 vs 雷霆', events);
    expect(hit?.homeEn).toBe('Oklahoma City Thunder');
  });

  it('认不出的队不瞎猜', () => {
    expect(findSchedule('篮球', '卡德 vs 耶鲁竞技', events)).toBeUndefined();
    expect(findSchedule('篮球', '雷霆 vs 卡德', events)).toBeUndefined();
  });
});

describe('attachSchedule', () => {
  const base = (title: string): LiveMatch => ({
    category: '篮球',
    league: 'NBA',
    title,
    status: 'upcoming',
    variants: [{ line: '高清', url: 'http://a' }],
  });

  it('补上开赛时间与比分', () => {
    const matches = [base('雷霆 vs 掘金'), base('卡德 vs 耶鲁竞技')];
    const hit = attachSchedule(matches, [
      makeEvent({ homeScore: 112, awayScore: 123, ended: true }),
    ]);
    expect(hit).toBe(1);
    expect(matches[0].startAt).toBe(Date.parse('2026-10-26T01:00:00Z'));
    expect(matches[0].score).toBe('112-123');
    // 认不出的那场不填
    expect(matches[1].startAt).toBeUndefined();
    expect(matches[1].score).toBeUndefined();
  });

  it('没有赛程时不动任何字段', () => {
    const matches = [base('雷霆 vs 掘金')];
    expect(attachSchedule(matches, [])).toBe(0);
    expect(matches[0].startAt).toBeUndefined();
  });
});

describe('按开赛时间推断状态', () => {
  const now = Date.parse('2026-10-26T10:00:00Z');

  it('还没开始 → upcoming', () => {
    expect(inferStatus(Date.parse('2026-10-26T12:00:00Z'), now)).toBe('upcoming');
  });

  it('开赛 3 小时内 → live', () => {
    expect(inferStatus(Date.parse('2026-10-26T09:00:00Z'), now)).toBe('live');
  });

  it('超过 3 小时 → ended', () => {
    expect(inferStatus(Date.parse('2026-10-26T05:00:00Z'), now)).toBe('ended');
  });

  it('只补 unknown 状态，不覆盖上游明确给的状态', () => {
    const match: LiveMatch = {
      category: '篮球',
      league: 'NBA',
      title: '雷霆 vs 掘金',
      status: 'ended',
      variants: [{ line: '高清', url: 'http://a' }],
    };
    attachSchedule([match], [makeEvent({ startAt: Date.parse('2026-10-26T12:00:00Z') })], now);
    expect(match.status).toBe('ended');
  });
});
