/**
 * @file 探测状态标签：把四个结论翻译成"人话 + 颜色 + 图标"。
 */

import Chip from '@mui/material/Chip';
import type { BrowserVerdict } from '../lib/probeClient';

/** 结论 → 展示配置。 */
const VERDICT_META: Record<BrowserVerdict, { label: string; color: 'success' | 'warning' | 'error' | 'default' }> = {
  alive: { label: '✅ 可用', color: 'success' },
  reachable: { label: '⚠️ 可达·浏览器受限', color: 'warning' },
  dead: { label: '❌ 失效', color: 'error' },
  timeout: { label: '⏱️ 超时', color: 'default' },
};

/** 组件属性。 */
export interface StatusChipProps {
  /** 探测结论 */
  verdict: BrowserVerdict;
  /** 是否小尺寸 */
  small?: boolean;
}

/**
 * 状态标签组件。
 *
 * @param props 组件属性
 * @return 组件
 */
export default function StatusChip(props: StatusChipProps): JSX.Element {
  const meta = VERDICT_META[props.verdict];
  return (
    <Chip
      label={meta.label}
      color={meta.color}
      size={props.small === true ? 'small' : 'medium'}
      variant={props.verdict === 'reachable' ? 'outlined' : 'filled'}
      sx={{ fontWeight: 600, fontSize: props.small === true ? '0.72rem' : '0.8rem' }}
    />
  );
}
