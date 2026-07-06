import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { isDark, setDark } from '@/lib/theme';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const [dark, setDarkState] = useState(isDark());
  return (
    <Button
      variant="ghost"
      size="icon"
      title="Alternar tema claro/escuro"
      onClick={() => {
        const next = !dark;
        setDarkState(next);
        setDark(next);
      }}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
