/**
 * @file 三步上手教程（首页用）。
 */

import type { ReactNode } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';

/** 一个步骤。 */
export interface GuideStep {
  /** 步骤标题 */
  title: string;
  /** 步骤说明 */
  description: string;
  /** 可选的补充提示 */
  tip?: string;
}

/** 组件属性。 */
export interface GuideStepsProps {
  /** 步骤列表 */
  steps: readonly GuideStep[];
  /** 渲染在步骤下方的额外内容（比如复制按钮） */
  children?: ReactNode;
}

/**
 * 步骤教程组件。
 *
 * @param props 组件属性
 * @return 组件
 */
export default function GuideSteps(props: GuideStepsProps): JSX.Element {
  return (
    <Stack spacing={1.5}>
      {props.steps.map((step, index) => (
        <Paper key={step.title} sx={{ p: 1.5, borderRadius: 2 }}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box
              sx={{
                flex: '0 0 auto',
                width: 30,
                height: 30,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.95rem',
              }}
            >
              {index + 1}
            </Box>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {step.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {step.description}
              </Typography>
              {step.tip !== undefined && (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                  小提示：{step.tip}
                </Typography>
              )}
            </Box>
          </Stack>
        </Paper>
      ))}
      {props.children}
    </Stack>
  );
}
