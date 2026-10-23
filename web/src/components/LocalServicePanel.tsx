/**
 * @file 本机服务开关面板（仅本机模式可见）。
 *
 * 两个独立开关：网页服务、赛事服务。
 * 「关」在这里点一下就生效——因为要关的时候服务本来就在跑。
 * 「开」需要从 Termux 执行 `web.sh` / `live.sh`（服务不存在时页面也打不开）。
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';

import { LOCAL_MODE } from '../lib/serveApi';

/** 两个开关的状态。 */
interface SwitchState {
  web: 'on' | 'off';
  live: 'on' | 'off';
}

/**
 * 本机服务开关面板。
 *
 * @return 组件；非本机模式返回 null
 */
export default function LocalServicePanel(): JSX.Element | null {
  const [state, setState] = useState<SwitchState | null>(null);
  const [busy, setBusy] = useState<'web' | 'live' | null>(null);
  const [note, setNote] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('./api/state', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as Partial<SwitchState>;
      setState({ web: data.web === 'on' ? 'on' : 'off', live: data.live === 'on' ? 'on' : 'off' });
    } catch {
      // 服务可能刚被关掉，忽略
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const toggle = useCallback(async (target: 'web' | 'live') => {
    setBusy(target);
    setNote('');
    try {
      const current = state?.[target] === 'on';
      const value = current ? 'off' : 'on';
      const response = await fetch('./api/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target, value }),
      });
      if (!response.ok) {
        setNote('切换失败，请稍后再试');
      } else if (target === 'web' && value === 'off') {
        setNote('网页服务已关闭，本页面即将断开（想再开就在 Termux 里执行 web.sh）');
      } else {
        await load();
      }
    } catch {
      setNote('切换失败，请稍后再试');
    } finally {
      setBusy(null);
    }
  }, [load, state]);

  if (!LOCAL_MODE) {
    return null;
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>
        <PowerSettingsNewIcon sx={{ verticalAlign: 'middle', mr: 0.5, fontSize: 20 }} />
        本机服务开关
      </Typography>

      <Stack spacing={1.5}>
        <Alert severity="info">
          <Typography variant="body2">
            网页服务<strong>只在你要用的时候开</strong>，不用就关掉，手机就不会一直耗电。
            赛事服务是电视看球用的，可以常开。
          </Typography>
        </Alert>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant={state?.web === 'on' ? 'contained' : 'outlined'}
            color={state?.web === 'on' ? 'warning' : 'primary'}
            onClick={() => void toggle('web')}
            disabled={busy !== null}
            startIcon={busy === 'web' ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            网页服务：{state === null ? '…' : state.web === 'on' ? '运行中（点击关闭）' : '已关闭（点击开启）'}
          </Button>
          <Button
            variant={state?.live === 'on' ? 'contained' : 'outlined'}
            color={state?.live === 'on' ? 'warning' : 'primary'}
            onClick={() => void toggle('live')}
            disabled={busy !== null}
            startIcon={busy === 'live' ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            赛事服务：{state === null ? '…' : state.live === 'on' ? '运行中（点击关闭）' : '已关闭（点击开启）'}
          </Button>
        </Stack>

        {note.length > 0 && <Alert severity="warning">{note}</Alert>}

        <Typography variant="caption" color="text.secondary">
          网页服务开着但 30 分钟没人访问会自动关闭（省电保险丝）。想重新开启：在 Termux 里执行{' '}
          <code>web.sh</code> 或 <code>live.sh</code>。
        </Typography>
      </Stack>
    </Box>
  );
}