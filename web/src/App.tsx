/**
 * @file 应用外壳：顶部导航 + 路由 + 免责声明页脚。
 */

import { Box, Container, Divider, Stack, Tab, Tabs, Typography } from '@mui/material';
import { Link as RouterLink, Route, Routes, useLocation } from 'react-router-dom';

import Home from './pages/Home';
import Tester from './pages/Tester';
import Update from './pages/Update';

/** 三个页面（Hash 路由）。 */
const NAV_ITEMS: ReadonlyArray<{ path: string; label: string }> = [
  { path: '/', label: '首页' },
  { path: '/tester', label: '测源（检测能不能用）' },
  { path: '/update', label: '一键更新' },
];

/**
 * 应用根组件。
 *
 * @return 页面骨架
 */
export default function App(): JSX.Element {
  const location = useLocation();
  const currentIndex = Math.max(
    0,
    NAV_ITEMS.findIndex((item) => item.path === location.pathname),
  );

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ bgcolor: 'background.paper', borderBottom: '1px solid #e6e8eb', position: 'sticky', top: 0, zIndex: 10 }}>
        <Container maxWidth="md" sx={{ pt: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Typography variant="h5" component="h1" sx={{ flexGrow: 1, fontSize: { xs: '1.1rem', sm: '1.3rem' } }}>
              我的电视源
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
              自动抓源 · 自动测活 · 一个链接长期用
            </Typography>
          </Stack>
          <Tabs
            value={currentIndex}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{ minHeight: 44 }}
          >
            {NAV_ITEMS.map((item) => (
              <Tab
                key={item.path}
                label={item.label}
                component={RouterLink}
                to={item.path}
                sx={{ minHeight: 44, fontSize: { xs: '0.82rem', sm: '0.92rem' } }}
              />
            ))}
          </Tabs>
        </Container>
      </Box>

      <Container maxWidth="md" sx={{ flexGrow: 1, py: { xs: 2, sm: 3 } }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tester" element={<Tester />} />
          <Route path="/update" element={<Update />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Container>

      <Box component="footer" sx={{ bgcolor: 'background.paper', borderTop: '1px solid #e6e8eb', py: 2 }}>
        <Container maxWidth="md">
          <Divider sx={{ mb: 1.5 }} />
          <Typography variant="caption" color="text.secondary" component="p" sx={{ lineHeight: 1.8 }}>
            免责声明：本页所有播放地址均来自公开网络，版权归各广播机构所有。本项目只做公开链接的技术聚合与可用性探测，
            不存储、不转码、不分发任何节目内容。请自行确认使用行为的合法性。
          </Typography>
        </Container>
      </Box>
    </Box>
  );
}
