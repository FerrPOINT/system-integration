import { Label } from '../../shared/ui/label';
import { Notice } from '../../shared/ui/notice';
import { Select } from '../../shared/ui/select';
import { useEffect, useLayoutEffect, useState } from 'react';

export type Theme = 'dark' | 'light' | 'gray';
const storageKey = 'system-integration.theme';
const isTheme = (value: string | null): value is Theme => value === 'dark' || value === 'light' || value === 'gray';
type Preference = { theme: Theme; notice: string };
const storageNotice = 'Браузер не сохраняет тему. Выбор действует в этой вкладке.';

function readPreference(): Preference {
  try {
    const value = localStorage.getItem(storageKey);
    return {
      theme: isTheme(value) ? value : 'dark',
      notice: value !== null && !isTheme(value) ? 'Сохранённая тема не распознана. Выберите тему заново.' : '',
    };
  } catch {
    return { theme: 'dark', notice: storageNotice };
  }
}

export function useThemePreference() {
  const [preference, setPreference] = useState(readPreference);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = preference.theme;
  }, [preference.theme]);
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) setPreference(readPreference());
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  function setTheme(theme: Theme) {
    let notice = '';
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      notice = storageNotice;
    }
    setPreference({ theme, notice });
  }
  return { ...preference, setTheme };
}

export function ThemePicker({ theme, setTheme, notice }: ReturnType<typeof useThemePreference>) {
  return (
    <div className="theme-picker">
      <Label className="theme-control" htmlFor="theme-choice">
        <span>Тема</span>
        <Select
          id="theme-choice"
          aria-label="Цветовая тема"
          value={theme}
          onValueChange={(value) => setTheme(value as Theme)}
          options={[
            { value: 'dark', label: 'Тёмная' },
            { value: 'light', label: 'Светлая' },
            { value: 'gray', label: 'Серая' },
          ]}
        />
      </Label>
      {notice && (
        <div className="theme-notice">
          <Notice role="status">{notice}</Notice>
        </div>
      )}
    </div>
  );
}
