import {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
  useEffect,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { DEFAULT_THEME, type Theme } from './theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_COLORS: Record<Theme, string> = {
  light: '#f6f7f2',
  dark: '#050608',
};

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLORS[theme];
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const location = useLocation();

  // 每次路由变化默认复位为浅色；声明暗色的页面会在其 PageTheme 中重新置暗。
  useLayoutEffect(() => {
    setTheme(DEFAULT_THEME);
  }, [location.pathname]);

  // 把当前主题同步到 <html data-theme> 与 meta。
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

/**
 * 由营销页在顶层渲染：声明该页应使用的主题。
 * 用 useLayoutEffect 抢在 paint 前置主题，避免与路由复位竞态产生闪烁。
 */
export function PageTheme({ theme }: { theme: Theme }) {
  const { setTheme } = useTheme();
  useLayoutEffect(() => {
    setTheme(theme);
  }, [theme, setTheme]);
  return null;
}
