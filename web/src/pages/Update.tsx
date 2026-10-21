/**
 * @file 一键更新：填钥匙（Token）→ 触发构建 → 轮询进度 → 拿产物链接。
 *
 * 安全边界：
 *   - Token 只存 localStorage，输入框 `type=password`，页面只显示掩码
 *   - 触发用带 Token 的请求；**轮询一律匿名**（公开仓库不需要权限）
 *   - 任何错误信息都不包含 Token 原文
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
  Link,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import CopyField from '../components/CopyField';
import {
  buildLinks,
  formatDateTime,
  formatRelative,
  resolveRepo,
  writeRepoOverride,
  type RepoRef,
} from '../lib/links';
import {
  GithubApiError,
  WORKFLOW_FILE,
  dispatchWorkflow,
  listRuns,
  verifyToken,
  type RunSummary,
} from '../lib/githubApi';

/** Token 在 localStorage 的键名。 */
const TOKEN_KEY = 'iptv_hub_github_token';

/** 轮询间隔（ms）。 */
const POLL_INTERVAL_MS = 10_000;

/** 最长轮询时长（ms）。 */
const MAX_POLL_MS = 30 * 60 * 1000;

/** 四个阶段的文案。 */
const STEPS = [
  '排队中：GitHub 正在分配机器（一般 20 秒内）',
  '抓取公开源：正在从多个上游下载列表（约 1 分钟）',
  '测活与优选：正在逐个检测能不能播（约 10 分钟，最久的一步）',
  '生成文件并发布：写出 txt / m3u / EPG 并上线（约 1 分钟）',
] as const;

/** 页面阶段。 */
type Phase = 'idle' | 'dispatching' | 'polling' | 'success' | 'failure';

/**
 * 读取本地保存的 Token。
 *
 * @return Token 或空串
 */
function readToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * 保存 / 清除 Token。
 *
 * @param token Token，空串表示清除
 */
function saveToken(token: string): void {
  try {
    if (token.length === 0) {
      window.localStorage.removeItem(TOKEN_KEY);
      return;
    }
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 隐私模式下 localStorage 可能不可用
  }
}

/**
 * 把 Token 变成掩码文案（只保留末 4 位）。
 *
 * @param token Token
 * @return 掩码
 */
function maskToken(token: string): string {
  if (token.length <= 4) {
    return '••••';
  }
  return `••••••••${token.slice(-4)}`;
}

/**
 * 根据已用时长推断当前处在第几步。
 *
 * @param elapsedMs 已用毫秒
 * @return 步骤下标 0~3
 */
function stepFromElapsed(elapsedMs: number): number {
  const seconds = elapsedMs / 1000;
  if (seconds < 45) {
    return 0;
  }
  if (seconds < 180) {
    return 1;
  }
  if (seconds < 900) {
    return 2;
  }
  return 3;
}

/**
 * 一键更新页面。
 *
 * @return 页面
 */
export default function Update(): JSX.Element {
  const initialRepo = useMemo(() => resolveRepo(), []);
  const [repo, setRepo] = useState<RepoRef | null>(initialRepo);
  const [ownerInput, setOwnerInput] = useState(initialRepo?.owner ?? '');
  const [repoInput, setRepoInput] = useState(initialRepo?.repo ?? '');
  const [branch, setBranch] = useState('main');

  const [token, setToken] = useState(readToken);
  const [tokenDraft, setTokenDraft] = useState(readToken);
  const [tokenNotice, setTokenNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [actionHint, setActionHint] = useState('');
  const [run, setRun] = useState<RunSummary | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastSuccess, setLastSuccess] = useState<RunSummary | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);

  const knownRunIdsRef = useRef<Set<number>>(new Set());
  const startedAtRef = useRef<number>(0);
  const polling = phase === 'polling';

  /**
   * 首次进入：拉一次最近运行，展示"上次成功更新时间"。
   */
  useEffect(() => {
    if (repo === null) {
      return;
    }
    let cancelled = false;
    setRunsLoading(true);
    void (async () => {
      try {
        const runs = await listRuns(repo, 10);
        if (cancelled) {
          return;
        }
        const success = runs.find((item) => item.conclusion === 'success');
        setLastSuccess(success ?? null);
      } catch {
        // 提示类信息失败不打扰用户
      } finally {
        if (!cancelled) {
          setRunsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  /**
   * 轮询计时器（1 秒一次）。
   */
  useEffect(() => {
    if (!polling) {
      return;
    }
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [polling]);

  /**
   * 轮询运行状态（匿名请求，10 秒一次，最多 30 分钟）。
   */
  useEffect(() => {
    if (!polling || repo === null) {
      return;
    }
    let cancelled = false;

    const tick = async (): Promise<void> => {
      try {
        const runs = await listRuns(repo, 10);
        if (cancelled) {
          return;
        }
        const fresh = runs.find((item) => !knownRunIdsRef.current.has(item.id));
        if (fresh === undefined) {
          return;
        }
        setRun(fresh);

        if (fresh.status === 'completed') {
          if (fresh.conclusion === 'success') {
            setPhase('success');
            setMessage('构建完成，列表已经更新，去电视上重新加载一次就能看到新源。');
            setActionHint('');
            setLastSuccess(fresh);
          } else {
            setPhase('failure');
            setMessage(`构建没有通过（${fresh.conclusion ?? '未知原因'}）。上一版列表仍然可用。`);
            setActionHint('点下面的「查看详细日志」，里面会写清楚失败在哪一步。');
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof GithubApiError) {
          setMessage(error.failure.message);
          setActionHint(error.failure.action);
        } else {
          setMessage('查询运行状态失败，稍后会自动重试');
        }
      }

      if (Date.now() - startedAtRef.current > MAX_POLL_MS && !cancelled) {
        setPhase('failure');
        setMessage('等了 30 分钟还没有结果，已停止查询。');
        setActionHint('去仓库的 Actions 页面看看实际状态（可能还在跑）。');
      }
    };

    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [polling, repo, phase]);

  /**
   * 保存 Token 并校验。
   */
  const handleSaveToken = async (): Promise<void> => {
    const value = tokenDraft.trim();
    if (value.length === 0) {
      setTokenNotice({ ok: false, text: '请先粘贴你的 Token' });
      return;
    }
    setToken(value);
    saveToken(value);
    if (repo === null) {
      setTokenNotice({ ok: true, text: '已保存在本机浏览器（还没填仓库名，暂时无法校验）' });
      return;
    }
    const check = await verifyToken(value, repo);
    setTokenNotice({
      ok: check.ok,
      text: check.ok ? '已保存，这把钥匙可以访问你的仓库' : `保存了，但校验没过：${check.message}${check.action === undefined ? '' : ` — ${check.action}`}`,
    });
  };

  /**
   * 清除 Token。
   */
  const handleClearToken = (): void => {
    setToken('');
    setTokenDraft('');
    saveToken('');
    setTokenNotice({ ok: true, text: '已从这台设备上删除' });
  };

  /**
   * 保存高级设置里的仓库名。
   */
  const handleSaveRepo = (): void => {
    const owner = ownerInput.trim();
    const name = repoInput.trim();
    if (owner.length === 0 || name.length === 0) {
      setMessage('用户名和仓库名都要填');
      return;
    }
    const next = { owner, repo: name };
    writeRepoOverride(next);
    setRepo(next);
    setMessage('已保存仓库信息');
  };

  /**
   * 触发构建。
   */
  const handleDispatch = async (): Promise<void> => {
    if (repo === null) {
      setPhase('failure');
      setMessage('还不知道你的仓库名');
      setActionHint('请先展开下面的「高级设置」，填写用户名和仓库名并保存。');
      return;
    }
    if (token.length === 0) {
      setPhase('failure');
      setMessage('还没有填钥匙（Token）');
      setActionHint('按上面第 1 步生成一个 Token 粘进来。');
      return;
    }

    setPhase('dispatching');
    setMessage('');
    setActionHint('');
    setRun(null);
    setElapsedMs(0);

    try {
      const runs = await listRuns(repo, 10);
      knownRunIdsRef.current = new Set(runs.map((item) => item.id));
    } catch {
      knownRunIdsRef.current = new Set();
    }

    try {
      await dispatchWorkflow(token, repo, branch);
      startedAtRef.current = Date.now();
      setPhase('polling');
    } catch (error) {
      setPhase('failure');
      if (error instanceof GithubApiError) {
        setMessage(error.failure.message);
        setActionHint(error.failure.action);
      } else {
        setMessage('触发失败，请稍后重试');
        setActionHint('也可以直接去仓库的 Actions 页面点「Run workflow」。');
      }
    }
  };

  const links = useMemo(() => (repo === null ? null : buildLinks(repo)), [repo]);
  const currentStep = stepFromElapsed(elapsedMs);
  const elapsedText = `${Math.floor(elapsedMs / 60000)} 分 ${Math.round((elapsedMs % 60000) / 1000)} 秒`;
  const runUrl = run?.html_url ?? (repo === null ? null : `https://github.com/${repo.owner}/${repo.repo}/actions/workflows/${WORKFLOW_FILE}`);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" component="h2" sx={{ mb: 0.5 }}>
          一键更新（让列表立刻重新生成）
        </Typography>
        <Typography variant="body2" color="text.secondary">
          不用装任何软件。填一次钥匙，以后想更新就点一下按钮。
        </Typography>
      </Box>

      {/* 第 1 步：Token */}
      <Paper sx={{ p: 1.5 }}>
        <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
          第 1 步 · 粘贴你的 GitHub 钥匙（Token）
        </Typography>
        <TextField
          type="password"
          value={tokenDraft}
          onChange={(event) => setTokenDraft(event.target.value)}
          label="在这里粘贴 Token"
          placeholder="ghp_ 或 github_pat_ 开头的长串"
          fullWidth
          size="small"
          autoComplete="off"
          InputProps={{ sx: { fontFamily: 'monospace' } }}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
          <Button variant="contained" onClick={() => void handleSaveToken()}>
            保存
          </Button>
          <Button variant="outlined" color="inherit" onClick={handleClearToken} disabled={token.length === 0}>
            清除
          </Button>
          <Link
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer noopener"
            underline="hover"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: '0.85rem' }}
          >
            去生成 Token（免费）<OpenInNewIcon sx={{ fontSize: 14 }} />
          </Link>
        </Stack>

        {token.length > 0 && (
          <Chip size="small" label={`当前已保存：${maskToken(token)}`} sx={{ mt: 1 }} color="success" variant="outlined" />
        )}

        {tokenNotice !== null && (
          <Alert severity={tokenNotice.ok ? 'success' : 'warning'} sx={{ mt: 1 }}>
            {tokenNotice.text}
          </Alert>
        )}

        <Alert severity="info" sx={{ mt: 1.5 }}>
          <Typography variant="body2" component="div">
            <b>Token 是什么：</b>相当于你仓库的一把钥匙，GitHub 免费发给你。
            <br />
            <b>去哪生成：</b>点上面的链接 → 选「Only select repositories」勾这个仓库 →
            Permissions 里把 <code>Actions</code> 设成 <code>Read and write</code> → 生成后复制过来。
            <br />
            <b>安全吗：</b>钥匙只存在你这台设备的浏览器里，不会上传、不会写进日志。请像密码一样保管，用完可以随时点「清除」。
          </Typography>
        </Alert>
      </Paper>

      {/* 第 2 步：触发 */}
      <Paper sx={{ p: 1.5 }}>
        <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
          第 2 步 · 点按钮
        </Typography>
        <Button
          variant="contained"
          size="large"
          fullWidth
          onClick={() => void handleDispatch()}
          disabled={phase === 'dispatching' || phase === 'polling'}
          startIcon={phase === 'dispatching' || phase === 'polling' ? <CircularProgress size={18} color="inherit" /> : undefined}
        >
          {phase === 'dispatching' ? '正在提交…' : phase === 'polling' ? '正在构建…' : '立即更新列表'}
        </Button>

        {(phase === 'polling' || phase === 'dispatching') && (
          <Box sx={{ mt: 2 }}>
            <Stepper activeStep={currentStep} alternativeLabel>
              {STEPS.map((label) => (
                <Step key={label}>
                  <StepLabel
                    StepIconProps={{ sx: { fontSize: 20 } }}
                    sx={{ '& .MuiStepLabel-label': { fontSize: { xs: '0.66rem', sm: '0.76rem' } } }}
                  >
                    {label.split('：')[0]}
                  </StepLabel>
                </Step>
              ))}
            </Stepper>
            <Typography variant="body2" sx={{ mt: 1 }}>
              当前：{STEPS[currentStep]}　已用 {elapsedText}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              构建大约需要 10 分钟。这个页面每 10 秒自动查一次进度，可以关掉再回来。
            </Typography>
          </Box>
        )}

        {phase === 'success' && (
          <Alert severity="success" sx={{ mt: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              ✅ {message}
            </Typography>
            <Typography variant="caption">完成时间：{run === null ? '—' : formatDateTime(run.created_at)}</Typography>
          </Alert>
        )}

        {phase === 'failure' && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              ❌ {message}
            </Typography>
            {actionHint.length > 0 && <Typography variant="caption">下一步：{actionHint}</Typography>}
          </Alert>
        )}

        {runUrl !== null && (
          <Typography variant="caption" component="p" sx={{ mt: 1 }}>
            <Link href={runUrl} target="_blank" rel="noreferrer noopener" underline="hover">
              查看详细日志（Actions 页面）
            </Link>
          </Typography>
        )}
      </Paper>

      {/* 第 3 步：产物链接 */}
      <Paper sx={{ p: 1.5 }}>
        <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
          第 3 步 · 把链接复制到电视里
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }} useFlexGap flexWrap="wrap">
          <Chip
            size="small"
            color={lastSuccess === null ? 'default' : 'success'}
            variant={lastSuccess === null ? 'outlined' : 'filled'}
            label={
              runsLoading
                ? '正在读取上次构建…'
                : lastSuccess === null
                  ? '还没查到成功记录'
                  : `上次成功：${formatDateTime(lastSuccess.created_at)}（${formatRelative(lastSuccess.created_at)}）`
            }
          />
        </Stack>

        {links === null ? (
          <Alert severity="warning">先在下面的「高级设置」里填写用户名和仓库名。</Alert>
        ) : (
          <Stack spacing={1.5}>
            {links.all.slice(0, 3).map((link) => (
              <CopyField key={link.key} label={link.label} value={link.url} hint={link.description} />
            ))}
          </Stack>
        )}
      </Paper>

      <Divider />

      {/* 高级设置 */}
      <Accordion sx={{ border: '1px solid #e6e8eb', '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2">高级设置（一般不用改）</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1.5 }}>
            如果页面没能自动识别你的仓库（自定义域名、或者本地打开），在这里手动填一次，以后链接就都对了。
          </Typography>
          <Stack spacing={1.5}>
            <TextField
              label="GitHub 用户名（就是仓库地址里第一段）"
              value={ownerInput}
              onChange={(event) => setOwnerInput(event.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="仓库名（就是仓库地址里第二段）"
              value={repoInput}
              onChange={(event) => setRepoInput(event.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="默认分支名"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              size="small"
              fullWidth
              helperText="GitHub 新建的仓库一般是 main；老仓库可能是 master"
            />
            <Button variant="outlined" onClick={handleSaveRepo}>
              保存仓库信息
            </Button>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
}
