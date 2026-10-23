/**
 * @file 赛事刷新卡片（仅本机模式可见）。
 *
 * 就是一个按钮：点一下只重拉赛事清单，秒级完成，
 * **不重走主列表那 2000+ 条源的测活**，所以不用等几分钟。
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import SportsIcon from '@mui/icons-material/Sports';

import CopyField from './CopyField';
import {
  LOCAL_MODE,
  fetchLiveStatus,
  formatDuration,
  refreshLive,
  type LiveRefreshResult,
} from '../lib/serveApi';

/**
 * 赛事刷新卡片。
 *
 * @return 组件；非本机模式返回 null
 */
export default function LiveRefreshCard(): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LiveRefreshResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await fetchLiveStatus();
      if (!cancelled) {
        setResult(status);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onClick = useCallback(async () => {
    setBusy(true);
    setResult({ ok: false, running: true });
    const next = await refreshLive();
    setResult(next);
    setBusy(false);
  }, []);

  if (!LOCAL_MODE) {
    return null;
  }

  const liveTxtUrl = `${window.location.origin}/live/live.txt`;
  const ok = result?.ok === true;

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>
        <SportsIcon sx={{ verticalAlign: 'middle', mr: 0.5, fontSize: 20 }} />
        赛事直播（秒级刷新）
      </Typography>

      <Stack spacing={1.5}>
        <Alert severity="info">
          <Typography variant="body2">
            这一块<strong>不走主列表</strong>：点按钮只会重新拉一次赛事清单（足球 / 篮球 / 电竞），
            通常 2~3 秒完成，不会碰频道列表、也不会重新测活。
          </Typography>
          <Typography variant="caption">
            需要本机的 wudaliansai 服务正在运行（默认 18765 端口）。电视和手机连同一个 Wi-Fi 时，
            下面这个链接可以直接给影视仓 / TVBox 用。
          </Typography>
        </Alert>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            onClick={() => void onClick()}
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <SportsIcon />}
          >
            {busy ? '正在刷新…' : '刷新赛事'}
          </Button>
          {loaded && result !== null && !busy && (
            <Typography variant="caption" color="text.secondary">
              {ok
                ? `上次刷新：${result.matches ?? 0} 场 / ${result.lines ?? 0} 条线路，直播中 ${result.liveNow ?? 0} 场，用时 ${formatDuration(result.durationMs)}`
                : (result.message ?? '尚未刷新过')}
            </Typography>
          )}
        </Stack>

        {!busy && result !== null && !ok && result.message !== undefined && (
          <Alert severity="warning">{result.message}</Alert>
        )}

        <CopyField
          label="赛事清单地址（给影视仓 / TVBox）"
          value={liveTxtUrl}
          hint="本机地址，只有这台手机浏览器打得开；电视要用它，请改用局域网地址"
        />
      </Stack>
    </Box>
  );
}