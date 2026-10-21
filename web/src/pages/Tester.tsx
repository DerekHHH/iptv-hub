/**
 * @file 测源工作台：粘贴/上传 → 浏览器内并发检测 → 排序筛选表格 → 复制/导出。
 *
 * 全部计算在用户自己的浏览器里完成，源文本不会上传到任何服务器。
 */

import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from '@mui/material';

import StatusChip from '../components/StatusChip';
import { copyText } from '../components/CopyField';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_TIMEOUT_MS,
  MAX_CONCURRENCY,
  buildExportTxt,
  probeAllBrowser,
  type BrowserProbeResult,
  type BrowserVerdict,
} from '../lib/probeClient';
import { downloadTextFile, parseSourceText } from '../lib/parseSource';

/** 排序字段。 */
type SortKey = 'rawName' | 'url' | 'verdict' | 'latencyMs' | 'resolution' | 'bandwidth';

/** 状态筛选项。 */
type FilterKey = 'all' | BrowserVerdict;

/** 示例文本（placeholder 用）。 */
const EXAMPLE = `CCTV1,http://example.com/live/cctv1/index.m3u8
翡翠台,http://example.com/live/tvb-jade/index.m3u8
http://example.com/live/unknown/index.m3u8`;

/**
 * 把带宽转成 Mbps 文案。
 *
 * @param bandwidth bps
 * @return 文案
 */
function formatBandwidth(bandwidth: number | null): string {
  if (bandwidth === null || !Number.isFinite(bandwidth) || bandwidth <= 0) {
    return '—';
  }
  return `${(bandwidth / 1_000_000).toFixed(1)} Mbps`;
}

/**
 * 测源页面。
 *
 * @return 页面
 */
export default function Tester(): JSX.Element {
  const [inputText, setInputText] = useState('');
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  const [timeoutMs, setTimeoutMs] = useState(DEFAULT_TIMEOUT_MS);
  const [urlPrefix, setUrlPrefix] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BrowserProbeResult[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; alive: number }>({
    done: 0,
    total: 0,
    alive: 0,
  });
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('latencyMs');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [toast, setToast] = useState<{ text: string; severity: 'success' | 'warning' } | null>(null);
  const [error, setError] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const entries = useMemo(() => parseSourceText(inputText), [inputText]);

  const summary = useMemo(() => {
    const alive = results.filter((item) => item.verdict === 'alive').length;
    const reachable = results.filter((item) => item.verdict === 'reachable').length;
    const dead = results.filter((item) => item.verdict === 'dead').length;
    const timeout = results.filter((item) => item.verdict === 'timeout').length;
    return { alive, reachable, dead, timeout };
  }, [results]);

  const visibleRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const filtered = results.filter((item) => {
      if (filter !== 'all' && item.verdict !== filter) {
        return false;
      }
      if (keyword.length === 0) {
        return true;
      }
      return item.rawName.toLowerCase().includes(keyword) || item.url.toLowerCase().includes(keyword);
    });

    const direction = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((left, right) => {
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];
      if (leftValue === null || leftValue === undefined) {
        return 1;
      }
      if (rightValue === null || rightValue === undefined) {
        return -1;
      }
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue), 'zh-Hans-CN') * direction;
    });
  }, [results, filter, search, sortKey, sortDir]);

  const pagedRows = useMemo(
    () => visibleRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [visibleRows, page, rowsPerPage],
  );

  /**
   * 切换排序。
   *
   * @param key 字段
   */
  const toggleSort = (key: SortKey): void => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDir(key === 'latencyMs' || key === 'bandwidth' ? 'asc' : 'asc');
  };

  /**
   * 开始检测。
   */
  const handleStart = async (): Promise<void> => {
    setError('');
    if (entries.length === 0) {
      setError('没有解析到任何地址。每行一条，格式是「频道名,地址」或直接粘贴地址。');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults([]);
    setPage(0);
    setProgress({ done: 0, total: entries.length, alive: 0 });

    try {
      const nextResults = await probeAllBrowser(entries, {
        concurrency,
        timeoutMs,
        urlPrefix: urlPrefix.trim(),
        signal: controller.signal,
        onProgress: (done, total, alive) => setProgress({ done, total, alive }),
      });
      setResults(nextResults.filter((item) => item !== undefined));
    } catch (caught) {
      setError(caught instanceof Error ? `检测中断：${caught.message}` : '检测中断');
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  /**
   * 停止检测。
   */
  const handleStop = (): void => {
    abortRef.current?.abort();
    setRunning(false);
  };

  /**
   * 清空全部状态。
   */
  const handleClear = (): void => {
    abortRef.current?.abort();
    setInputText('');
    setResults([]);
    setProgress({ done: 0, total: 0, alive: 0 });
    setError('');
    setRunning(false);
  };

  /**
   * 上传文件（txt / m3u / m3u8）。
   *
   * @param event 事件
   */
  const handleFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }
    const text = await file.text();
    setInputText(text);
    setError('');
    event.target.value = '';
  };

  /**
   * 复制可用源（只含 alive 行）。
   */
  const handleCopyAlive = async (): Promise<void> => {
    const text = buildExportTxt(results.filter((item) => item.verdict === 'alive'));
    if (text.length === 0) {
      setToast({ text: '没有检测成功的源可以复制', severity: 'warning' });
      return;
    }
    const ok = await copyText(text);
    setToast({
      text: ok ? `已复制 ${summary.alive} 条可用源（格式与电视端 TXT 相同）` : '浏览器不允许自动复制，请改用「导出 txt」',
      severity: ok ? 'success' : 'warning',
    });
  };

  /**
   * 导出 txt（只含 alive 行，UTF-8 无 BOM）。
   */
  const handleExport = (): void => {
    const text = buildExportTxt(results.filter((item) => item.verdict === 'alive'));
    if (text.length === 0) {
      setToast({ text: '没有检测成功的源可以导出', severity: 'warning' });
      return;
    }
    downloadTextFile('可用源.txt', text);
    setToast({ text: '已导出「可用源.txt」', severity: 'success' });
  };

  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" component="h2" sx={{ mb: 0.5 }}>
          测源（看看这些地址还能不能用）
        </Typography>
        <Typography variant="body2" color="text.secondary">
          把源粘进来，点一下就知道哪些还能连上。检测在<b>你自己的浏览器</b>里跑，源不会上传到任何服务器。
        </Typography>
      </Box>

      <Paper sx={{ p: 1.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          ① 把源粘进来（每行一条，或「频道名,地址」）
        </Typography>
        <TextField
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          placeholder={EXAMPLE}
          multiline
          minRows={6}
          maxRows={14}
          fullWidth
          InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.82rem' } }}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mt: 1 }}>
          <input ref={fileRef} type="file" accept=".txt,.m3u,.m3u8,text/plain" hidden onChange={handleFile} />
          <Button variant="outlined" onClick={() => fileRef.current?.click()}>
            选择文件（.txt / .m3u）
          </Button>
          <Typography variant="caption" color="text.secondary">
            已解析 {entries.length} 条地址
          </Typography>
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          ② 调一下参数（不懂就保持默认）
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              同时检测几条（并发数）：{concurrency}
            </Typography>
            <Slider
              value={concurrency}
              min={1}
              max={MAX_CONCURRENCY}
              step={1}
              marks={[
                { value: 1, label: '1' },
                { value: DEFAULT_CONCURRENCY, label: '8' },
                { value: MAX_CONCURRENCY, label: '16' },
              ]}
              onChange={(_event, value) => setConcurrency(Array.isArray(value) ? (value[0] ?? 1) : value)}
              disabled={running}
            />
            <Typography variant="caption" color="text.secondary">
              浏览器对同一个网站只开 6 个连接，调太高反而更慢，建议 8。
            </Typography>
          </Box>
          <Box>
            <FormControl fullWidth size="small">
              <InputLabel id="timeout-label">单条超时</InputLabel>
              <Select
                labelId="timeout-label"
                label="单条超时"
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(Number(event.target.value))}
                disabled={running}
              >
                <MenuItem value={4000}>4 秒（网络快）</MenuItem>
                <MenuItem value={8000}>8 秒（推荐）</MenuItem>
                <MenuItem value={15000}>15 秒（网络慢）</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="自定义前缀（可选，绝大多数人不用填）"
              value={urlPrefix}
              onChange={(event) => setUrlPrefix(event.target.value)}
              size="small"
              fullWidth
              sx={{ mt: 1 }}
              placeholder="留空即可"
              disabled={running}
            />
          </Box>
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" size="large" onClick={() => void handleStart()} disabled={running || entries.length === 0}>
            {running ? '正在检测…' : '开始检测'}
          </Button>
          {running && (
            <Button variant="outlined" color="warning" onClick={handleStop}>
              停止
            </Button>
          )}
          <Button variant="text" onClick={handleClear} disabled={running && entries.length > 0}>
            清空
          </Button>
        </Stack>

        {error.length > 0 && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </Paper>

      {(running || progress.total > 0) && (
        <Paper sx={{ p: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.8 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              进度 {progress.done}/{progress.total}（{percent}%）
            </Typography>
            <Chip size="small" color="success" label={`可用 ${summary.alive}`} />
            {summary.reachable > 0 && <Chip size="small" color="warning" variant="outlined" label={`可达 ${summary.reachable}`} />}
          </Stack>
          <Box sx={{ height: 8, bgcolor: '#eceff1', borderRadius: 4, overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${percent}%`, bgcolor: 'primary.main', transition: 'width .2s' }} />
          </Box>
        </Paper>
      )}

      {results.length > 0 && (
        <Paper sx={{ p: 1.5 }}>
          <Alert severity="info" sx={{ mb: 1.5 }}>
            浏览器无法读取大部分跨域源的真实内容：标记「⚠️ 可达·浏览器受限」表示服务器有响应，但
            <b>没法区分 200 与 404/403</b>，也不代表一定能播。精确结果以仓库 Actions 的自动构建为准。
          </Alert>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5 }}>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="filter-label">状态筛选</InputLabel>
              <Select
                labelId="filter-label"
                label="状态筛选"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value as FilterKey);
                  setPage(0);
                }}
              >
                <MenuItem value="all">全部（{results.length}）</MenuItem>
                <MenuItem value="alive">可用（{summary.alive}）</MenuItem>
                <MenuItem value="reachable">可达·受限（{summary.reachable}）</MenuItem>
                <MenuItem value="dead">失效（{summary.dead}）</MenuItem>
                <MenuItem value="timeout">超时（{summary.timeout}）</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="搜索频道名或地址"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              fullWidth
            />
            <Button variant="contained" onClick={() => void handleCopyAlive()} sx={{ whiteSpace: 'nowrap' }}>
              复制可用源
            </Button>
            <Button variant="outlined" onClick={handleExport} sx={{ whiteSpace: 'nowrap' }}>
              导出 txt
            </Button>
          </Stack>

          <div className="table-scroll">
            <Table size="small" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell sortDirection={sortKey === 'rawName' ? sortDir : false}>
                    <TableSortLabel
                      active={sortKey === 'rawName'}
                      direction={sortKey === 'rawName' ? sortDir : 'asc'}
                      onClick={() => toggleSort('rawName')}
                    >
                      频道名
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={sortKey === 'url' ? sortDir : false}>
                    <TableSortLabel
                      active={sortKey === 'url'}
                      direction={sortKey === 'url' ? sortDir : 'asc'}
                      onClick={() => toggleSort('url')}
                    >
                      源地址
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sortDirection={sortKey === 'verdict' ? sortDir : false}>
                    <TableSortLabel
                      active={sortKey === 'verdict'}
                      direction={sortKey === 'verdict' ? sortDir : 'asc'}
                      onClick={() => toggleSort('verdict')}
                    >
                      状态
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={sortKey === 'latencyMs' ? sortDir : false}>
                    <TableSortLabel
                      active={sortKey === 'latencyMs'}
                      direction={sortKey === 'latencyMs' ? sortDir : 'asc'}
                      onClick={() => toggleSort('latencyMs')}
                    >
                      延迟
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right">分辨率</TableCell>
                  <TableCell align="right">码率</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pagedRows.map((row) => (
                  <TableRow key={row.url} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.rawName.length > 0 ? row.rawName : '—'}</TableCell>
                    <TableCell className="break-anywhere" sx={{ fontSize: '0.76rem', maxWidth: 260 }}>
                      {row.url}
                      {row.note.length > 0 && (
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ fontSize: '0.68rem' }}>
                          {row.note}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusChip verdict={row.verdict} small />
                    </TableCell>
                    <TableCell align="right">{row.latencyMs === null ? '—' : `${row.latencyMs} ms`}</TableCell>
                    <TableCell align="right">{row.resolution ?? '—'}</TableCell>
                    <TableCell align="right">{formatBandwidth(row.bandwidth)}</TableCell>
                  </TableRow>
                ))}
                {pagedRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      当前筛选条件下没有结果
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <TablePagination
            component="div"
            count={visibleRows.length}
            page={page}
            onPageChange={(_event, nextPage) => setPage(nextPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(Number(event.target.value));
              setPage(0);
            }}
            rowsPerPageOptions={[25, 50, 100]}
            labelRowsPerPage="每页条数"
            labelDisplayedRows={({ from, to, count }) => `${from}-${to} / 共 ${count} 条`}
          />
        </Paper>
      )}

      <Snackbar
        open={toast !== null}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast?.severity ?? 'success'} variant="filled" onClose={() => setToast(null)}>
          {toast?.text ?? ''}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
