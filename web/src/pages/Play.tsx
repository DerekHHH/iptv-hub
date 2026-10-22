/**
 * @file 播放页：`#/play/<频道 id>`，多源自动回退。
 *
 * hls.js 用自托管的 `player-assets/hls.min.js`（Vite 从 `web/public/` 拷进 `site/`），
 * **不走 CDN**——国内 CDN 不可达，且本项目定位是"运行时零外部依赖"。
 *
 * 回退策略（按方案第五节）：
 *   1. 先把该频道所有源并发探一遍，`alive` 排在前面（`reachable` 不算可用，只做兜底）
 *   2. 当前源 fatal 错误或 8 秒没解析出清单 → `destroy()` 换下一个
 *   3. 全部试完仍播不了 → 列出所有地址，提示改用影视仓 / VLC
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Divider, Link, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useParams } from 'react-router-dom';

import StatusChip from '../components/StatusChip';
import { loadChannels, resolveRepo, type ChannelsFile } from '../lib/links';
import { DEFAULT_TIMEOUT_MS, probeOneBrowser, type BrowserVerdict } from '../lib/probeClient';

/** hls.js 挂在 window 上的全局名（`hls.min.js` 是 UMD 包）。 */
declare global {
  interface Window {
    Hls?: HlsConstructor;
  }
}

/** hls.js 构造函数的形状（只声明用到的部分，避免为了一个库把类型包也拖进来）。 */
interface HlsConstructor {
  new (config?: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: { ERROR: string; MANIFEST_PARSED: string };
  ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
}

/** hls.js 实例（只声明用到的成员）。 */
interface HlsInstance {
  attachMedia(video: HTMLMediaElement): void;
  loadSource(url: string): void;
  startLoad(): void;
  destroy(): void;
  startLevel: number;
  on(event: string, handler: (event: string, data: HlsErrorData) => void): void;
}

/** hls.js 错误事件的数据。 */
interface HlsErrorData {
  fatal: boolean;
  type: string;
}

/** 起播超时（ms）：这么久还没解析出清单就算这个源不行。 */
const MANIFEST_TIMEOUT_MS = 8000;

/** 自托管 hls.js 的地址（相对 index.html，随 `base: './'` 走）。 */
const HLS_SCRIPT_URL = './player-assets/hls.min.js';

/** 加载状态机。 */
type Phase = 'loading' | 'probing' | 'playing' | 'exhausted' | 'unsupported';

/**
 * 动态加载自托管 hls.js（页面里只加载一次）。
 *
 * @return Hls 构造函数（加载失败返回 null）
 */
async function loadHls(): Promise<HlsConstructor | null> {
  if (window.Hls !== undefined) {
    return window.Hls;
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HLS_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('hls.js 加载失败'));
    document.head.appendChild(script);
  }).catch(() => undefined);
  return window.Hls ?? null;
}

/**
 * 播放页。
 *
 * @return 页面
 */
export default function Play(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const repo = useMemo(() => resolveRepo(), []);

  const [data, setData] = useState<ChannelsFile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [verdicts, setVerdicts] = useState<Record<string, BrowserVerdict>>({});
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const [message, setMessage] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const orderRef = useRef<string[]>([]);

  const channel = data?.channels.find((item) => item.id === id) ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await loadChannels(repo);
      if (cancelled) {
        return;
      }
      setData(next);
      if (next === null) {
        setPhase('exhausted');
        setMessage('没读到频道目录，请先在首页确认构建产物已经生成。');
        return;
      }
      if (!next.channels.some((item) => item.id === id)) {
        setNotFound(true);
        setPhase('exhausted');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, id]);

  // 探测 + 排序：alive 优先（保持原始顺序），reachable 次之，其余最后
  useEffect(() => {
    if (channel === null) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      setPhase('probing');
      const results = await Promise.all(
        channel.streams.map(async (url) => {
          const result = await probeOneBrowser({ rawName: channel.name, url }, { timeoutMs: DEFAULT_TIMEOUT_MS, signal: controller.signal });
          return { url, verdict: result.verdict };
        }),
      );
      if (cancelled) {
        return;
      }
      const map: Record<string, BrowserVerdict> = {};
      for (const item of results) {
        map[item.url] = item.verdict;
      }
      setVerdicts(map);

      const rank = (verdict: BrowserVerdict | undefined): number => {
        if (verdict === 'alive') {
          return 0;
        }
        if (verdict === 'reachable') {
          return 1;
        }
        return 2;
      };
      const ordered = [...channel.streams].sort((left, right) => rank(map[left]) - rank(map[right]));
      orderRef.current = ordered;
      setAttempt(0);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [channel]);

  // 尝试播放 orderRef.current[attempt]
  // 依赖里**不放 phase**：起播成功会改 phase，放进去会自己把自己重跑一遍、把播放器重建
  useEffect(() => {
    if (channel === null || !ready || attempt >= orderRef.current.length) {
      return;
    }
    const url = orderRef.current[attempt] as string;
    setCurrentUrl(url);

    if (/\.flv(?:[?#]|$)/i.test(url)) {
      setPhase('unsupported');
      setMessage('这是一个 FLV 直播源，网页播放器播不了，请把它导进影视仓 / VLC 使用。');
      return;
    }

    const video = videoRef.current;
    if (video === null) {
      return;
    }

    let disposed = false;
    let hls: HlsInstance | null = null;
    let manifestTimer: number | undefined;

    /**
     * 当前源失败 → 试下一个。
     *
     * @param reason 给用户看的原因
     */
    const fail = (reason: string): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      window.clearTimeout(manifestTimer);
      hls?.destroy();
      hls = null;
      if (attempt + 1 < orderRef.current.length) {
        setMessage(`${reason}，自动换下一个源…`);
        setAttempt((value) => value + 1);
      } else {
        setPhase('exhausted');
        setMessage(`${reason}。这个台的源都试过了，建议改用影视仓 / VLC。`);
      }
    };

    /**
     * 起播成功。
     */
    const succeed = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      window.clearTimeout(manifestTimer);
      setPhase('playing');
      setMessage('');
      void video.play().catch(() => undefined);
    };

    const isHls = /\.m3u8(?:[?#]|$)/i.test(url);

    if (!isHls) {
      // 直链（mp4 等）交给浏览器原生播放
      video.src = url;
      const onError = (): void => fail('这个源播不出来');
      video.addEventListener('error', onError, { once: true });
      video.addEventListener('loadeddata', succeed, { once: true });
      manifestTimer = window.setTimeout(() => fail(`超过 ${MANIFEST_TIMEOUT_MS / 1000} 秒没有画面`), MANIFEST_TIMEOUT_MS);
      return () => {
        disposed = true;
        window.clearTimeout(manifestTimer);
        video.removeEventListener('error', onError);
        video.removeEventListener('loadeddata', succeed);
        video.removeAttribute('src');
        video.load();
      };
    }

    void (async () => {
      const Hls = await loadHls();
      if (disposed) {
        return;
      }
      if (Hls === null || !Hls.isSupported()) {
        setPhase('unsupported');
        setMessage('这个浏览器不支持 HLS 播放（hls.js 没加载成功），请用 Chrome / Edge，或改用影视仓 / VLC。');
        return;
      }

      hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90, autoStartLoad: false });
      // 从最高档起播（同分辨率取码率最高的），网速跟不上时 hls.js 会自动降档
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        succeed();
      });
      hls.on(Hls.Events.ERROR, (event, errorData) => {
        if (errorData.fatal) {
          fail(errorData.type === Hls.ErrorTypes.NETWORK_ERROR ? '源连不上' : '源出错');
        }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.startLoad();
      manifestTimer = window.setTimeout(
        () => fail(`超过 ${MANIFEST_TIMEOUT_MS / 1000} 秒没有画面`),
        MANIFEST_TIMEOUT_MS,
      );
    })();

    return () => {
      disposed = true;
      window.clearTimeout(manifestTimer);
      hls?.destroy();
      hls = null;
    };
  }, [channel, attempt, ready]);

  if (notFound) {
    return (
      <Stack spacing={2}>
        <Alert severity="warning">找不到这个频道（id：{id}），可能频道目录已经更新了。</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/channels')} sx={{ alignSelf: 'flex-start' }}>
          回到频道浏览
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/channels')}>
          返回
        </Button>
        <Typography variant="h6" sx={{ flexGrow: 1 }} noWrap>
          {channel?.name ?? '正在读取…'}
        </Typography>
        {channel !== null && <Chip size="small" label={channel.group} variant="outlined" />}
      </Stack>

      <Box sx={{ bgcolor: '#000', borderRadius: 2, overflow: 'hidden', position: 'relative', aspectRatio: '16 / 9' }}>
        <video
          ref={videoRef}
          controls
          playsInline
          autoPlay
          muted
          style={{ width: '100%', height: '100%', display: 'block', background: '#000' }}
        />
        {(phase === 'loading' || phase === 'probing') && (
          <Stack
            alignItems="center"
            justifyContent="center"
            spacing={1}
            sx={{ position: 'absolute', inset: 0, color: '#fff' }}
          >
            <CircularProgress size={26} sx={{ color: '#fff' }} />
            <Typography variant="body2">{phase === 'probing' ? '正在挑一个能用的源…' : '正在读取频道目录…'}</Typography>
          </Stack>
        )}
      </Box>

      {message.length > 0 && <Alert severity={phase === 'exhausted' ? 'error' : 'info'}>{message}</Alert>}

      {phase === 'playing' && currentUrl.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
          正在播放第 {attempt + 1} / {orderRef.current.length} 个源：{currentUrl}
        </Typography>
      )}

      {channel !== null && ready && orderRef.current.length > 1 && phase !== 'playing' && phase !== 'exhausted' && (
        <Button
          variant="outlined"
          disabled={attempt + 1 >= orderRef.current.length}
          onClick={() => setAttempt((value) => value + 1)}
        >
          换个源试试
        </Button>
      )}

      {channel !== null && (
        <>
          <Divider />
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              这个台的全部源（共 {channel.streams.length} 个）
            </Typography>
            <Stack spacing={0.75}>
              {channel.streams.map((url, index) => (
                <Stack
                  key={url}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ bgcolor: '#fafafa', borderRadius: 1, px: 1, py: 0.75 }}
                >
                  <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
                    #{index + 1}
                  </Typography>
                  {verdicts[url] !== undefined && <StatusChip verdict={verdicts[url] as BrowserVerdict} small />}
                  <Link href={url} target="_blank" rel="noreferrer" variant="caption" sx={{ wordBreak: 'break-all' }}>
                    {url}
                  </Link>
                </Stack>
              ))}
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );
}