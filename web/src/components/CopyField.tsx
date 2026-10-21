/**
 * @file 可复制的链接字段：只读输入框 + 复制按钮 + 成功提示。
 *
 * 面向非技术用户：链接旁边永远有"复制"，不需要手动选中。
 */

import { useState } from 'react';
import { Box, Button, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';

/** 组件属性。 */
export interface CopyFieldProps {
  /** 字段名（中文，带括注） */
  label: string;
  /** 要复制的值 */
  value: string;
  /** 补充说明 */
  hint?: string;
  /** 值为空时的占位提示 */
  emptyText?: string;
}

/**
 * 复制文本到剪贴板（带降级方案，兼容 http 页面与老 WebView）。
 *
 * @param text 文本
 * @return 是否成功
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走降级方案
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 复制字段组件。
 *
 * @param props 组件属性
 * @return 组件
 */
export default function CopyField(props: CopyFieldProps): JSX.Element {
  const { label, value, hint, emptyText } = props;
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const isEmpty = value.trim().length === 0;

  /**
   * 处理复制点击。
   */
  const handleCopy = async (): Promise<void> => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
    } else {
      setFailed(true);
    }
  };

  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {label}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <TextField
          value={isEmpty ? '' : value}
          placeholder={isEmpty ? (emptyText ?? '还没有生成，请先去 Actions 跑一次') : ''}
          fullWidth
          size="small"
          InputProps={{
            readOnly: true,
            sx: { fontFamily: 'monospace', fontSize: '0.8rem' },
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title="点这里复制">
                  <IconButton size="small" onClick={handleCopy} disabled={isEmpty} aria-label={`复制${label}`}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ),
          }}
        />
        <Button
          variant="contained"
          onClick={handleCopy}
          disabled={isEmpty}
          startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}
          sx={{ whiteSpace: 'nowrap', minWidth: 96 }}
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </Stack>
      {hint !== undefined && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
          {hint}
        </Typography>
      )}

      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setCopied(false)}>
          已复制到剪贴板，去电视里粘贴吧
        </Alert>
      </Snackbar>
      <Snackbar
        open={failed}
        autoHideDuration={4000}
        onClose={() => setFailed(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="warning" variant="filled" onClose={() => setFailed(false)}>
          浏览器不允许自动复制，请长按输入框手动选中复制
        </Alert>
      </Snackbar>
    </Box>
  );
}
