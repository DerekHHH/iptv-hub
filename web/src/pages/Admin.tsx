/**
 * @file 管理后台：浏览器直写 GitHub API（改分组 / 隐藏频道 / 加自填源 / 调分类规则）。
 *
 * 安全边界：
 *   - Token 只放 localStorage，只在 `Authorization` 请求头里出现；绝不进 URL、绝不写日志
 *   - 建议用 Fine-grained token：只勾这个仓库，权限只勾 **Contents: Read and write** 与 **Actions: Read and write**
 *
 * 重要：写完文件只是产生一个 commit，**不等于生效**。
 * 还要等 Actions 重建（实测约 260 秒）+ Pages 部署，共 5~7 分钟。
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
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import { loadChannels, resolveRepo, writeRepoOverride, type ChannelsFile, type RepoRef } from '../lib/links';
import {
  GithubApiError,
  dispatchWorkflow,
  getFile,
  listRuns,
  updateTextFile,
  verifyToken,
} from '../lib/githubApi';
import { maskToken, readToken, saveToken } from '../lib/token';

/** 管理数据的路径（构建期读取，见方案第一节）。 */
const PATHS = {
  groups: 'data/groups.json',
  keywords: 'data/group-keywords.json',
  overrides: 'data/channel-overrides.json',
  hidden: 'data/hidden-channels.json',
  customSources: 'custom/sources.txt',
} as const;

/** 默认分支。 */
const MAIN_BRANCH = 'main';

/** 轮询进度间隔（ms）。 */
const POLL_INTERVAL_MS = 10_000;

/** 写文件后的生效提示（实测构建 260 秒 + 部署）。 */
const EFFECT_DELAY_HINT = '写完只是产生一次提交，还要等 Actions 重建（约 4~5 分钟）再部署（约 1 分钟），共 5~7 分钟才生效。';

/** 简单的 JSON 文件结构。 */
interface JsonFile {
  version: number;
  [key: string]: unknown;
}

/**
 * 把对象序列化成与构建侧 `writeJsonFile` 一致的格式（2 空格缩进 + 末尾换行）。
 *
 * @param value 可序列化对象
 * @return 文本
 */
function toJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * 安全解析 JSON（失败返回 null）。
 *
 * @param text 文本
 * @return 解析结果或 null
 */
function parseJson(text: string | null): JsonFile | null {
  if (text === null) {
    return null;
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    return value as JsonFile;
  } catch {
    return null;
  }
}

/**
 * 把 JSON 里某个数组字段读成字符串列表。
 *
 * @param file JSON 文件
 * @param key 字段名
 * @param field 数组元素里的字段名
 * @return 字符串列表
 */
function readStringList(file: JsonFile | null, key: string, field: string): string[] {
  const items = file?.[key];
  if (!Array.isArray(items)) {
    return [];
  }
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === 'object' && item !== null) {
      const value = (item as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.length > 0) {
        out.push(value);
      }
    }
  }
  return out;
}

/** 管理后台当前选中的页签。 */
type AdminTab = 'channel' | 'source' | 'group';

/**
 * 管理后台页面。
 *
 * @return 页面
 */
export default function Admin(): JSX.Element {
  const detected = useMemo(() => resolveRepo(), []);

  const [owner, setOwner] = useState(detected?.owner ?? '');
  const [repoName, setRepoName] = useState(detected?.repo ?? '');
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<{ severity: 'info' | 'success' | 'warning' | 'error'; text: string } | null>(null);

  const [tab, setTab] = useState<AdminTab>('channel');
  const [channels, setChannels] = useState<ChannelsFile | null>(null);
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [keywordText, setKeywordText] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [newSources, setNewSources] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [runStatus, setRunStatus] = useState<{ status: string; conclusion: string | null } | null>(null);

  const repoRef: RepoRef | null = owner.length > 0 && repoName.length > 0 ? { owner, repo: repoName } : null;

  useEffect(() => {
    setToken(readToken());
  }, []);

  /**
   * 连接仓库：校验 Token 并把四份管理数据读进内存。
   *
   * @return 无
   */
  const connect = async (): Promise<void> => {
    if (repoRef === null || token.length === 0) {
      setNotice({ severity: 'warning', text: '请先填写 Token 和「用户名 / 仓库名」。' });
      return;
    }
    setConnecting(true);
    setNotice(null);
    try {
      const check = await verifyToken(token, repoRef);
      if (!check.ok) {
        setVerified(false);
        setNotice({ severity: 'error', text: `${check.message}${check.action === undefined ? '' : ` —— ${check.action}`}` });
        return;
      }
      saveToken(token);
      writeRepoOverride(repoRef);

      const [channelsFile, groupsRaw, keywordsRaw, overridesRaw, hiddenRaw] = await Promise.all([
        loadChannels(repoRef),
        getFile(token, repoRef, PATHS.groups),
        getFile(token, repoRef, PATHS.keywords),
        getFile(token, repoRef, PATHS.overrides),
        getFile(token, repoRef, PATHS.hidden),
      ]);

      setChannels(channelsFile);
      setGroupOrder(readStringList(parseJson(groupsRaw?.content ?? null), 'order', ''));
      setKeywordText(keywordsRaw?.content ?? '[]\n');

      const overrideItems = parseJson(overridesRaw?.content ?? null)?.['items'];
      const overrideMap: Record<string, string> = {};
      if (Array.isArray(overrideItems)) {
        for (const item of overrideItems) {
          if (typeof item === 'object' && item !== null) {
            const { id, group } = item as { id?: unknown; group?: unknown };
            if (typeof id === 'string' && typeof group === 'string') {
              overrideMap[id] = group;
            }
          }
        }
      }
      setOverrides(overrideMap);
      setHidden(readStringList(parseJson(hiddenRaw?.content ?? null), 'items', 'id'));

      setVerified(true);
      setNotice({
        severity: 'success',
        text: `已连接 ${owner}/${repoName}。${channelsFile === null ? '（没读到 channels.json，频道列表要用搜索手动填 id）' : `读到 ${channelsFile.channels.length} 个频道。`}`,
      });
    } catch (error) {
      setVerified(false);
      setNotice({
        severity: 'error',
        text: error instanceof GithubApiError ? `${error.failure.message} —— ${error.failure.action}` : '连接失败，请稍后重试。',
      });
    } finally {
      setConnecting(false);
    }
  };

  /**
   * 写文件 → 触发构建 → 开始轮询。
   *
   * @param path 仓库内路径
   * @param build 由当前内容算新内容
   * @param message 提交信息
   * @return 无
   */
  const commit = async (path: string, build: (current: string | null) => string, message: string): Promise<void> => {
    if (repoRef === null || token.length === 0 || !verified) {
      setNotice({ severity: 'warning', text: '请先连接仓库。' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await updateTextFile(token, repoRef, path, build, message, MAIN_BRANCH);
      await dispatchWorkflow(token, repoRef, MAIN_BRANCH);
      setRunStatus({ status: 'queued', conclusion: null });
      setNotice({
        severity: 'success',
        text: `已提交 ${path} 并触发了重建。${EFFECT_DELAY_HINT}`,
      });
    } catch (error) {
      setNotice({
        severity: 'error',
        text: error instanceof GithubApiError ? `${error.failure.message} —— ${error.failure.action}` : '提交失败，请稍后重试。',
      });
    } finally {
      setBusy(false);
    }
  };

  // 提交后轮询最新一次运行（匿名请求，不需要 Token）
  useEffect(() => {
    if (runStatus === null || repoRef === null || runStatus.conclusion !== null) {
      return;
    }
    const timer = setInterval(() => {
      void (async () => {
        try {
          const runs = await listRuns(repoRef, 1);
          const latest = runs[0];
          if (latest !== undefined) {
            setRunStatus({ status: latest.status, conclusion: latest.conclusion });
          }
        } catch {
          // 轮询失败不打断用户
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [runStatus, repoRef]);

  const allGroups = groupOrder.length > 0 ? groupOrder : ['其他'];
  const keywordList = channels === null ? [] : channels.channels;
  const keyword = filter.trim().toLowerCase();
  const filteredChannels =
    keyword.length === 0
      ? keywordList.slice(0, 40)
      : keywordList.filter((item) => item.name.toLowerCase().includes(keyword) || item.id.includes(keyword)).slice(0, 40);

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h2">
        管理后台
      </Typography>

      {notice !== null && <Alert severity={notice.severity}>{notice.text}</Alert>}

      {runStatus !== null && (
        <Alert severity={runStatus.conclusion === 'success' ? 'success' : runStatus.conclusion === null ? 'info' : 'error'}>
          最近一次构建：{runStatus.status}
          {runStatus.conclusion === null ? '（还在跑，约 4~5 分钟）' : ` / ${runStatus.conclusion}`}
        </Alert>
      )}

      {/* 连接 */}
      <Paper sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          ① 连接你的仓库
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="用户名 / 组织名"
              value={owner}
              onChange={(event) => setOwner(event.target.value.trim())}
              size="small"
              fullWidth
            />
            <TextField
              label="仓库名"
              value={repoName}
              onChange={(event) => setRepoName(event.target.value.trim())}
              size="small"
              fullWidth
            />
          </Stack>
          <TextField
            label="访问钥匙（Token）"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value.trim())}
            size="small"
            fullWidth
            helperText={
              token.length === 0
                ? '需要 Fine-grained token，权限勾 Contents: Read and write 与 Actions: Read and write；只存在你这台设备的浏览器里。'
                : `当前保存的钥匙：${maskToken(token)}`
            }
          />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={() => void connect()} disabled={connecting}>
              {connecting ? '连接中…' : verified ? '重新读取' : '连接并校验'}
            </Button>
            {verified && <Chip color="success" label="已连接" />}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            钥匙只存在本机浏览器的 localStorage，只在请求头里出现，不会进网址、不会写日志。
          </Typography>
        </Stack>
      </Paper>

      <Tabs value={tab} onChange={(event, value: AdminTab) => setTab(value)} variant="scrollable">
        <Tab value="channel" label="频道分组 / 隐藏" />
        <Tab value="source" label="自填源" />
        <Tab value="group" label="分类与规则" />
      </Tabs>

      {tab === 'channel' && (
        <Paper sx={{ p: 2, borderRadius: 2 }}>
          <Stack spacing={1.5}>
            <TextField
              label="搜频道（名字或 id）"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              size="small"
              fullWidth
              placeholder="比如：翡翠 / 湖南 / cctv5"
            />
            {channels === null && (
              <Alert severity="info">没读到频道目录，可以先把仓库连接一次；也可以直接在「分类与规则」里手改 JSON。</Alert>
            )}
            <Stack spacing={1} sx={{ maxHeight: 360, overflowY: 'auto' }}>
              {filteredChannels.map((channel) => {
                const currentGroup = overrides[channel.id] ?? channel.group;
                const isHidden = hidden.includes(channel.id);
                return (
                  <Stack
                    key={channel.id}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'stretch', sm: 'center' }}
                    sx={{ bgcolor: '#fafafa', borderRadius: 1, p: 1 }}
                  >
                    <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>
                      {channel.name}
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {channel.id}
                      </Typography>
                    </Typography>
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                      <InputLabel>分组</InputLabel>
                      <Select
                        label="分组"
                        value={currentGroup}
                        onChange={(event) => {
                          const value = event.target.value;
                          setOverrides((prev) => {
                            const next = { ...prev };
                            if (value === channel.group) {
                              delete next[channel.id];
                            } else {
                              next[channel.id] = value;
                            }
                            return next;
                          });
                        }}
                      >
                        {allGroups.map((group) => (
                          <MenuItem key={group} value={group}>
                            {group}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button
                      size="small"
                      color={isHidden ? 'success' : 'error'}
                      variant="outlined"
                      onClick={() =>
                        setHidden((prev) =>
                          prev.includes(channel.id) ? prev.filter((item) => item !== channel.id) : [...prev, channel.id],
                        )
                      }
                    >
                      {isHidden ? '恢复' : '隐藏'}
                    </Button>
                  </Stack>
                );
              })}
            </Stack>

            <Typography variant="caption" color="text.secondary">
              已改分组 {Object.keys(overrides).length} 个 · 已隐藏 {hidden.length} 个
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button
                variant="contained"
                disabled={busy || !verified}
                onClick={() =>
                  void commit(
                    PATHS.overrides,
                    () =>
                      toJsonText({
                        version: 1,
                        items: Object.entries(overrides).map(([id, group]) => ({ id, group })),
                      }),
                    'chore(admin): 调整频道分组',
                  )
                }
              >
                保存分组改动并重建
              </Button>
              <Button
                variant="outlined"
                disabled={busy || !verified}
                onClick={() =>
                  void commit(
                    PATHS.hidden,
                    () => toJsonText({ version: 1, items: hidden.map((id) => ({ id })) }),
                    'chore(admin): 更新屏蔽名单',
                  )
                }
              >
                保存隐藏名单并重建
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {tab === 'source' && (
        <Paper sx={{ p: 2, borderRadius: 2 }}>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              每行一个，格式 <code>频道名,地址</code>（中文逗号也行）。追加到 <code>{PATHS.customSources}</code>，
              构建时会和其他上游一起抓取、测活。
            </Typography>
            <TextField
              label="要追加的源"
              value={newSources}
              onChange={(event) => setNewSources(event.target.value)}
              multiline
              minRows={4}
              fullWidth
              placeholder={'我的翡翠台,http://example.com/jade.m3u8\nhttp://example.com/other.m3u8'}
            />
            <Button
              variant="contained"
              disabled={busy || !verified || newSources.trim().length === 0}
              onClick={() =>
                void commit(
                  PATHS.customSources,
                  (current) => {
                    const existing = (current ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
                    const added = newSources
                      .split('\n')
                      .map((line) => line.trim())
                      .filter((line) => line.length > 0)
                      .join('\n');
                    return `${existing.length > 0 ? `${existing}\n` : ''}${added}\n`;
                  },
                  'chore(admin): 追加自填源',
                )
              }
            >
              追加并重建
            </Button>
            <Typography variant="caption" color="text.secondary">
              {EFFECT_DELAY_HINT} 无效源会在下次构建时被自动测掉。
            </Typography>
          </Stack>
        </Paper>
      )}

      {tab === 'group' && (
        <Paper sx={{ p: 2, borderRadius: 2 }}>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              分组顺序决定电视里显示的先後；关键字规则是「第一个命中的关键字决定分组」，数组顺序就是优先级。
            </Typography>

            <TextField
              label="分组顺序（逗号分隔）"
              value={groupOrder.join(', ')}
              onChange={(event) =>
                setGroupOrder(
                  event.target.value
                    .split(/[,，]/)
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0),
                )
              }
              fullWidth
              size="small"
              helperText="最后一项应该是「其他」，作为兜底。新增的分组会自动排到已知分组后面。"
            />
            <Button
              variant="contained"
              disabled={busy || !verified || groupOrder.length === 0}
              onClick={() =>
                void commit(PATHS.groups, () => toJsonText({ version: 1, order: groupOrder }), 'chore(admin): 调整分组顺序')
              }
            >
              保存分组顺序并重建
            </Button>

            <Divider />

            <Accordion sx={{ border: '1px solid #e6e8eb', '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="body2">高级：直接编辑关键字规则（JSON）</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1}>
                  <TextField
                    value={keywordText}
                    onChange={(event) => setKeywordText(event.target.value)}
                    multiline
                    minRows={12}
                    fullWidth
                    inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.78rem' } }}
                  />
                  <Alert severity="warning">
                    写错 JSON 会让构建读不到规则（退化成一堆「其他」）。保存前请确认能解析。
                  </Alert>
                  <Button
                    variant="contained"
                    disabled={busy || !verified || parseJson(keywordText) === null}
                    onClick={() =>
                      void commit(
                        PATHS.keywords,
                        () => `${keywordText.replace(/\s+$/, '')}\n`,
                        'chore(admin): 调整分组关键字规则',
                      )
                    }
                  >
                    保存规则并重建
                  </Button>
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Stack>
        </Paper>
      )}

      {busy && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            正在写入 GitHub…
          </Typography>
        </Stack>
      )}

      <Box>
        <Typography variant="caption" color="text.secondary">
          改完不会立刻生效：{EFFECT_DELAY_HINT}
        </Typography>
      </Box>
    </Stack>
  );
}
