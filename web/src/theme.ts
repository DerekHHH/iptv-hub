/**
 * @file MUI 主题：浅色、大字号（电视端可读）、圆角柔和。
 */

import { createTheme } from '@mui/material/styles';

/** 中文优先的字体栈（不引入外部 CDN，避免阻塞）。 */
const FONT_STACK = [
  '"Noto Sans SC"',
  '"PingFang SC"',
  '"Microsoft YaHei"',
  '"Hiragino Sans GB"',
  'system-ui',
  '-apple-system',
  'sans-serif',
].join(',');

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' },
    secondary: { main: '#00897b' },
    success: { main: '#2e7d32' },
    warning: { main: '#ed6c02' },
    error: { main: '#c62828' },
    background: { default: '#f7f8fa', paper: '#ffffff' },
    text: { primary: '#1f2329', secondary: '#5c6470' },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: FONT_STACK,
    h4: { fontSize: '1.6rem', fontWeight: 700 },
    h5: { fontSize: '1.28rem', fontWeight: 700 },
    h6: { fontSize: '1.08rem', fontWeight: 600 },
    body1: { fontSize: '0.98rem', lineHeight: 1.7 },
    body2: { fontSize: '0.9rem', lineHeight: 1.7 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 10 } },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: '1px solid #e6e8eb' } },
    },
    MuiTableCell: {
      styleOverrides: { root: { paddingTop: 10, paddingBottom: 10 } },
    },
  },
});
