/**
 * @file 首页 / 状态看板：一眼看懂"有多少台、怎么用、链接在哪"。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Link as RouterLink } from 'react-router-dom';

import CopyField from '../components/CopyField';
import GuideSteps from '../components/GuideSteps';
import LiveRefreshCard from '../components/LiveRefreshCard';
import StatCards from '../components/StatCards';
import {
  buildLinks,
  buildLocalLinks,
  formatDateTime,
  formatRelative,
  isLocalHost,
  loadHistory,
  loadStats,
  resolveRepo,
  type History,
  type Stats,
} from '../lib/links';

/** 分组概况的展示顺序（分组体系已数据驱动，未知分组追加到末尾）。 */
const KNOWN_GROUP_ORDER = ['港澳台', '广东', '央视', '卫视', '体育', '影视', '国际', '地方台'] as const;

/**
 * 按「已知分组在前、未知分组在后」排出要展示的分组名。
 *
 * @param stats 构建统计
 * @return 分组名列表
 */
function orderedGroupNames(stats: Stats): string[] {
  const names = Object.keys(stats.groups ?? {});
  const known = KNOWN_GROUP_ORDER.filter((group) => names.includes(group));
  const rest = names.filter((group) => !KNOWN_GROUP_ORDER.includes(group as (typeof KNOWN_GROUP_ORDER)[number]));
  return [...known, ...rest];
}

/**
 * 首页。
 *
 * @return 页面
 */
export default function Home(): JSX.Element {
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);

  const repo = useMemo(() => resolveRepo(), []);
  const local = useMemo(() => isLocalHost(), []);
  // 本机模式优先给本机链接；只有拿不到本机地址时才退回 github.io 三套。
  const links = useMemo(() => {
    if (typeof window !== 'undefined' && isLocalHost()) {
      return buildLocalLinks(window.location.origin);
    }
    return repo === null ? null : buildLinks(repo);
  }, [repo]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [nextStats, nextHistory] = await Promise.all([loadStats(), loadHistory()]);
      if (!cancelled) {
        setStats(nextStats);
        setHistory(nextHistory);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updatedLabel =
    stats === null ? '还没有数据' : `${formatRelative(stats.updated_at)}更新`;
  const epgLabel = stats?.epg?.ok === true ? `✅ 有 ${stats.epg.programmes} 条节目` : '⚠️ 暂无节目单';

  return (
    <Stack spacing={2}>
      {/* 状态行 */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
        <Typography variant="h5" component="h2" sx={{ flexGrow: 1 }}>
          我的电视源
        </Typography>
        <Chip
          label={loading ? '正在读取…' : updatedLabel}
          color={stats === null ? 'default' : stats.stale ? 'warning' : 'success'}
          variant={stats === null ? 'outlined' : 'filled'}
        />
      </Stack>

      {stats?.stale === true && (
        <Alert severity="warning">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            这次构建没有更新成功，当前显示的是上一次的列表
          </Typography>
          <Typography variant="caption">
            原因：{stats.stale_reason ?? '上游数据异常'}；数据时间：{formatDateTime(stats.updated_at)}
            （{formatRelative(stats.updated_at)}）。旧列表仍然可以继续用。
          </Typography>
        </Alert>
      )}

      {stats === null && !loading && (
        <Alert severity="info">
          还没读到构建数据（<code>stats.json</code>）。如果你刚 Fork 完，请先去仓库的
          <b> Actions </b>标签页手动运行一次「更新电视源」，大约 10 分钟后这里就有数据了。
        </Alert>
      )}

      {links === null && !local && (
        <Alert severity="info">
          没能从当前网址推断出仓库名。请到「一键更新」页面的高级设置里手动填写
          <b> 用户名 </b>和<b> 仓库名</b>，所有链接会自动生成。
        </Alert>
      )}

      {/* 统计卡片 */}
      <StatCards
        items={[
          { label: '可用频道', value: stats?.channel_count ?? '—', hint: '测活通过才会列出' },
          { label: '可用源', value: stats?.source_count ?? '—', hint: '每个频道最多 3 个备用' },
          {
            label: '每台备用数',
            value: '3',
            hint: '一个挂了自动换下一个',
          },
          { label: '节目单（EPG）', value: stats?.epg?.ok === true ? '有' : '无', hint: epgLabel },
        ]}
      />

      {/* 赛事刷新（本机模式才显示） */}
      <LiveRefreshCard />

      {/* 三步教程 */}
      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>
          三步搞定（配一次，以后不用管）
        </Typography>
        <GuideSteps
          steps={[
            {
              title: '① 复制下面这个链接',
              description: '这是你的专属电视源地址，官方每 6 小时自动更新一次。',
              tip: '链接变了不用管，一直用这一个就行。',
            },
            {
              title: '② 打开电视里的播放器 → 设置 → 直播源 → 粘贴',
              description: 'DIYP、影视仓、TVBox 都有「直播源 / 自定义源」的输入框，把链接粘进去。',
              tip: '播放器要能联网，第一次加载可能要等十几秒。',
            },
            {
              title: '③ 重启播放器，开始看',
              description: '频道会自动按「港澳台 → 广东 → 央视 → 卫视」排好，第一个分组就是港澳台。',
            },
          ]}
        >
          <Paper sx={{ p: 1.5, borderRadius: 2 }}>
            {links === null ? (
              <Alert severity="warning">请先在「一键更新」页面填写你的用户名和仓库名。</Alert>
            ) : (
              <CopyField
                label={links.primary.label}
                value={links.primary.url}
                hint={links.primary.description}
              />
            )}
          </Paper>
        </GuideSteps>
      </Box>

      {/* 其他格式 */}
      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>
          其他格式 / 备用链接
        </Typography>
        <Stack spacing={1.5}>
          {links === null ? (
            <Alert severity="warning">未能推断仓库名，链接暂不可用。</Alert>
          ) : (
            links.all.slice(1).map((link) => (
              <CopyField key={link.key} label={link.label} value={link.url} hint={link.description} />
            ))
          )}
        </Stack>
        <Accordion sx={{ mt: 1.5, border: '1px solid #e6e8eb', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2">三种链接有什么区别？（点开看）</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary" component="div">
              <p>
                <b>Pages 链接</b>：形如 <code>你的名字.github.io/仓库名/txt/all.txt</code>。走 GitHub 的
                静态站，速度快、最稳，优先用它。
              </p>
              <p>
                <b>GitHub 原始地址（raw）</b>：形如 <code>raw.githubusercontent.com/...</code>。最直接，但
                国内有时会被拦，播放器加载不出来时换一个。
              </p>
              <p>
                <b>jsDelivr 镜像</b>：形如 <code>cdn.jsdelivr.net/gh/...</code>。国内加速通道，内容每 12 小时
                同步一次，可能比 Pages 稍旧。
              </p>
            </Typography>
          </AccordionDetails>
        </Accordion>
      </Box>

      {/* 分组概况 */}
      {stats !== null && (
        <Box>
          <Typography variant="h6" sx={{ mb: 1 }}>
            分组概况
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {orderedGroupNames(stats).map((group) => (
              <Chip
                key={group}
                label={`${group} ${stats.groups?.[group] ?? 0}`}
                variant="outlined"
                color={group === '港澳台' || group === '广东' ? 'primary' : 'default'}
              />
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            上次构建耗时 {stats.build_duration_ms === undefined ? '—' : `${Math.round(stats.build_duration_ms / 1000)} 秒`}
            ；共测试 {stats.probe?.total ?? '—'} 条源，存活 {stats.probe?.alive ?? '—'} 条
            {stats.hidden_count !== undefined ? `；按屏蔽名单丢掉 ${stats.hidden_count} 个台` : ''}。
          </Typography>
        </Box>
      )}

      {/* 历史趋势 */}
      {history !== null && history.items.length > 1 && (
        <Box>
          <Typography variant="h6" sx={{ mb: 1 }}>
            最近几次构建
          </Typography>
          <Paper sx={{ p: 0, overflow: 'hidden' }}>
            <div className="table-scroll">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>时间</TableCell>
                    <TableCell align="right">频道数</TableCell>
                    <TableCell align="right">源数</TableCell>
                    <TableCell align="right">结果</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[...history.items].reverse().map((item, index) => (
                    <TableRow key={`${item.updated_at}-${index}`}>
                      <TableCell>{formatDateTime(item.updated_at)}</TableCell>
                      <TableCell align="right">{item.channel_count}</TableCell>
                      <TableCell align="right">{item.source_count}</TableCell>
                      <TableCell align="right">
                        <Chip
                          size="small"
                          label={item.stale ? '降级' : '正常'}
                          color={item.stale ? 'warning' : 'success'}
                          variant={item.stale ? 'outlined' : 'filled'}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Paper>
        </Box>
      )}

      <Divider />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="outlined" component={RouterLink} to="/tester" fullWidth>
          去测源（看看自己找的源能不能用）
        </Button>
        <Button variant="outlined" component={RouterLink} to="/update" fullWidth>
          立即更新列表
        </Button>
      </Stack>
    </Stack>
  );
}
