/**
 * @file 频道浏览页：分类导航 + 搜索 + 卡片网格，点卡片进播放页。
 *
 * 数据来源是构建产物 `dist/channels.json`（`loadChannels`，带 jsDelivr 兜底）。
 * 频道多（400+）且手机内存有限，因此：
 *   - 单组一次最多渲染 `PAGE_SIZE` 张卡片，靠「加载更多」增量展开
 *   - 存活源数需要真实探测，默认不自动跑；点「检测本页」只测当前已展开的这些台
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from 'react-router-dom';

import StatusChip from '../components/StatusChip';
import { loadChannels, resolveRepo, type ChannelsFile } from '../lib/links';
import { DEFAULT_CONCURRENCY, DEFAULT_TIMEOUT_MS, probeOneBrowser, type BrowserVerdict } from '../lib/probeClient';

/** 频道目录里的单条频道。 */
type ChannelEntry = ChannelsFile['channels'][number];

/** 「全部」伪分组的名字。 */
const ALL_GROUP = '全部';

/** 一次渲染多少张卡片。 */
const PAGE_SIZE = 36;

/** 搜索防抖时长（ms）。 */
const SEARCH_DEBOUNCE_MS = 200;

/** 单个频道的探测结论。 */
interface ChannelProbe {
  verdict: BrowserVerdict;
  alive: number;
  total: number;
}

/**
 * 频道浏览页。
 *
 * @return 页面
 */
export default function Channels(): JSX.Element {
  const navigate = useNavigate();
  const repo = useMemo(() => resolveRepo(), []);

  const [data, setData] = useState<ChannelsFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState<string>(ALL_GROUP);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [probes, setProbes] = useState<Record<string, ChannelProbe>>({});
  const [probeProgress, setProbeProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await loadChannels(repo);
      if (!cancelled) {
        setData(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  // 搜索防抖：打字期间不重排 400 张卡片
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // 离开页面时中断还在跑的探测
  useEffect(() => () => abortRef.current?.abort(), []);

  const channels = data?.channels ?? [];

  const filtered = useMemo(() => {
    const keyword = debouncedQuery;
    return channels.filter((channel) => {
      if (activeGroup !== ALL_GROUP && channel.group !== activeGroup) {
        return false;
      }
      if (keyword.length === 0) {
        return true;
      }
      if (channel.name.toLowerCase().includes(keyword)) {
        return true;
      }
      if (channel.group.toLowerCase().includes(keyword)) {
        return true;
      }
      return (channel.aliases ?? []).some((alias) => alias.toLowerCase().includes(keyword));
    });
  }, [channels, activeGroup, debouncedQuery]);

  // 换分组或换关键词都要回到第一页
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeGroup, debouncedQuery]);

  const visibleChannels = filtered.slice(0, visibleCount);

  /**
   * 探测「当前已展开」这些台的源，算出每个台存活几个源。
   *
   * 只测已展开的（默认 36 台），并发按 `probeClient` 的默认值走，
   * 避免手机上一次性打几百个请求。
   *
   * @return 无
   */
  const probeVisible = async (): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const jobs: Array<{ channelId: string; url: string }> = [];
    for (const channel of visibleChannels) {
      // 每个台最多测前 2 个源：足够判断"这个台还有没有活的"，不至于把请求数翻 5 倍
      for (const url of channel.streams.slice(0, 2)) {
        jobs.push({ channelId: channel.id, url });
      }
    }
    if (jobs.length === 0) {
      return;
    }

    setProbeProgress({ done: 0, total: jobs.length });
    const tally = new Map<string, ChannelProbe>();
    let cursor = 0;
    let done = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (controller.signal.aborted) {
          return;
        }
        const index = cursor;
        cursor += 1;
        if (index >= jobs.length) {
          return;
        }
        const job = jobs[index] as { channelId: string; url: string };
        const result = await probeOneBrowser(
          { rawName: '', url: job.url },
          { timeoutMs: DEFAULT_TIMEOUT_MS, signal: controller.signal },
        );
        const current = tally.get(job.channelId) ?? { verdict: 'dead' as BrowserVerdict, alive: 0, total: 0 };
        current.total += 1;
        if (result.verdict === 'alive') {
          current.alive += 1;
          current.verdict = 'alive';
        } else if (current.verdict !== 'alive') {
          current.verdict = result.verdict;
        }
        tally.set(job.channelId, current);
        done += 1;
        setProbeProgress({ done, total: jobs.length });
      }
    };

    const workers: Array<Promise<void>> = [];
    for (let index = 0; index < Math.min(DEFAULT_CONCURRENCY, jobs.length); index += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (!controller.signal.aborted) {
      setProbes((prev) => {
        const next = { ...prev };
        for (const [channelId, value] of tally) {
          next[channelId] = value;
        }
        return next;
      });
      setProbeProgress(null);
    }
  };

  if (loading) {
    return (
      <Stack alignItems="center" sx={{ py: 6 }}>
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          正在读取频道目录…
        </Typography>
      </Stack>
    );
  }

  if (data === null) {
    return (
      <Alert severity="info">
        还没读到频道目录（<code>channels.json</code>）。如果你刚 Fork 完，先去仓库的
        <b> Actions </b>标签页手动运行一次「更新电视源」，构建完成后这里就能浏览了。
      </Alert>
    );
  }

  const groupNames = [ALL_GROUP, ...data.groups.map((group) => group.name)];
  const groupCount = (name: string): number =>
    name === ALL_GROUP ? data.channels.length : (data.groups.find((group) => group.name === name)?.count ?? 0);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <Typography variant="h5" component="h2" sx={{ flexGrow: 1 }}>
          频道浏览
        </Typography>
        <Typography variant="caption" color="text.secondary">
          共 {data.channels.length} 个台 · {data.groups.length} 个分类
        </Typography>
      </Stack>

      <TextField
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜频道名 / 别名 / 分类"
        size="small"
        fullWidth
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
      />

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        {/* 手机：横向可滚 chip 行 */}
        <Box
          sx={{
            display: { xs: 'flex', md: 'none' },
            gap: 1,
            overflowX: 'auto',
            pb: 1,
            width: '100%',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {groupNames.map((name) => (
            <Chip
              key={name}
              label={`${name} ${groupCount(name)}`}
              onClick={() => setActiveGroup(name)}
              color={activeGroup === name ? 'primary' : 'default'}
              variant={activeGroup === name ? 'filled' : 'outlined'}
              sx={{ flexShrink: 0 }}
            />
          ))}
        </Box>

        {/* 桌面：左栏 */}
        <Box sx={{ display: { xs: 'none', md: 'block' }, width: 150, flexShrink: 0 }}>
          {groupNames.map((name) => (
            <Box
              key={name}
              onClick={() => setActiveGroup(name)}
              sx={{
                px: 1.5,
                py: 0.75,
                mb: 0.5,
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                bgcolor: activeGroup === name ? '#e6f7ff' : '#fafafa',
                borderLeft: '3px solid',
                borderLeftColor: activeGroup === name ? 'primary.main' : 'transparent',
                color: activeGroup === name ? 'primary.main' : 'text.primary',
                fontWeight: activeGroup === name ? 600 : 400,
                '&:hover': { bgcolor: '#e6f7ff' },
              }}
            >
              {name}
              <Box component="span" sx={{ float: 'right', color: 'text.secondary', fontSize: '0.75rem' }}>
                {groupCount(name)}
              </Box>
            </Box>
          ))}
        </Box>

        {/* 右侧内容 */}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
              筛出 {filtered.length} 个台
              {probeProgress !== null && ` · 检测中 ${probeProgress.done}/${probeProgress.total}`}
            </Typography>
            <Button size="small" variant="outlined" onClick={() => void probeVisible()} disabled={probeProgress !== null}>
              检测本页
            </Button>
          </Stack>

          {probeProgress !== null && <LinearProgress sx={{ mb: 1.5 }} />}

          {filtered.length === 0 && (
            <Alert severity="info">这个词没有匹配到频道，换个写法试试（比如「翡翠」「CCTV」「体育」）。</Alert>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 1.25,
            }}
          >
            {visibleChannels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                probe={probes[channel.id]}
                onClick={() => navigate(`/play/${channel.id}`)}
              />
            ))}
          </Box>

          {visibleCount < filtered.length && (
            <Button
              fullWidth
              variant="text"
              sx={{ mt: 1.5 }}
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              加载更多（还剩 {filtered.length - visibleCount} 个）
            </Button>
          )}
        </Box>
      </Box>
    </Stack>
  );
}

/** 单张频道卡片。 */
interface ChannelCardProps {
  channel: ChannelEntry;
  /** 探测结论（没测过就是 undefined） */
  probe?: ChannelProbe;
  /** 点卡片 */
  onClick: () => void;
}

/**
 * 频道卡片（样式照 akira 的 `.channel-item`）。
 *
 * @param props 组件属性
 * @return 卡片
 */
function ChannelCard({ channel, probe, onClick }: ChannelCardProps): JSX.Element {
  const [logoBroken, setLogoBroken] = useState(false);
  const showLogo = channel.logo !== undefined && channel.logo.length > 0 && !logoBroken;

  return (
    <Paper
      onClick={onClick}
      elevation={0}
      sx={{
        p: 1.25,
        bgcolor: '#fafafa',
        borderRadius: '4px',
        border: '1px solid transparent',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all .25s',
        '&:hover': {
          bgcolor: '#e6f7ff',
          borderColor: 'primary.main',
          transform: 'translateY(-2px)',
          boxShadow: '0 2px 8px rgba(24,144,255,.2)',
        },
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          mx: 'auto',
          mb: 0.75,
          borderRadius: '50%',
          bgcolor: 'background.paper',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          fontSize: '0.9rem',
          fontWeight: 600,
          color: 'text.secondary',
        }}
      >
        {showLogo ? (
          <Box
            component="img"
            src={channel.logo}
            alt=""
            loading="lazy"
            onError={() => setLogoBroken(true)}
            sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          channel.name.slice(0, 1)
        )}
      </Box>

      <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3, mb: 0.5 }} noWrap title={channel.name}>
        {channel.name}
      </Typography>

      <Stack direction="row" spacing={0.5} justifyContent="center" alignItems="center" flexWrap="wrap">
        <Chip label={channel.group} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.68rem' }} />
        {probe === undefined ? (
          <Typography variant="caption" color="text.secondary">
            {channel.streams.length} 个源
          </Typography>
        ) : (
          <StatusChip verdict={probe.verdict} small />
        )}
      </Stack>
    </Paper>
  );
}
