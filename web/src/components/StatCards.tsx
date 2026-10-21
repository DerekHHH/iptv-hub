/**
 * @file 统计卡片组：一眼看清"有多少台、多少个源、什么时候更新的"。
 */

import { Box, Paper, Stack, Typography } from '@mui/material';

/** 单个统计项。 */
export interface StatItem {
  /** 指标名（中文） */
  label: string;
  /** 主数值 */
  value: string | number;
  /** 补充说明 */
  hint?: string;
}

/** 组件属性。 */
export interface StatCardsProps {
  /** 统计项 */
  items: readonly StatItem[];
}

/**
 * 统计卡片组。
 *
 * @param props 组件属性
 * @return 组件
 */
export default function StatCards(props: StatCardsProps): JSX.Element {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
        gap: 1.5,
      }}
    >
      {props.items.map((item) => (
        <Paper key={item.label} sx={{ p: 1.5, borderRadius: 2 }}>
          <Stack spacing={0.4}>
            <Typography variant="caption" color="text.secondary">
              {item.label}
            </Typography>
            <Typography variant="h5" component="p" sx={{ fontSize: { xs: '1.15rem', sm: '1.35rem' } }}>
              {item.value}
            </Typography>
            {item.hint !== undefined && (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                {item.hint}
              </Typography>
            )}
          </Stack>
        </Paper>
      ))}
    </Box>
  );
}
