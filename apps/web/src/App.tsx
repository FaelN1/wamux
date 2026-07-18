import { useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ChevronRight, KeyRound } from 'lucide-react';
import { getApiKey, setApiKey } from '@/api';
import { AppSidebar } from '@/components/app-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DashboardPage } from '@/pages/DashboardPage';
import { InstancesPage } from '@/pages/InstancesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { PlaygroundPage } from '@/pages/PlaygroundPage';
import { InboxPage } from '@/pages/InboxPage';

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/instances': 'Instâncias',
  '/inbox': 'Inbox',
  '/playground': 'Playground',
  '/settings': 'Configurações',
};

export default function App() {
  const [authed, setAuthed] = useState(!!getApiKey());
  const logout = () => setAuthed(false);

  if (!authed) return <ApiKeyGate onSaved={() => setAuthed(true)} />;

  return (
    <Routes>
      <Route element={<Shell onLogout={logout} />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="instances" element={<InstancesPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="playground" element={<PlaygroundPage />} />
        <Route path="settings" element={<SettingsPage onLogout={logout} />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? 'Dashboard';
  return (
    <SidebarProvider>
      <AppSidebar onLogout={onLogout} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between border-b bg-card/50 px-4 backdrop-blur-sm sm:px-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mx-1 h-5" />
            <div className="flex items-center text-sm">
              <span className="text-muted-foreground">App</span>
              <ChevronRight className="mx-2 size-3 text-muted-foreground/60" />
              <span className="font-medium text-foreground">{title}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <div className="ml-1 flex size-8 items-center justify-center rounded-full border bg-muted text-xs font-medium text-foreground">
              AD
            </div>
          </div>
        </header>
        <div className="w-full flex-1 overflow-auto p-4 sm:p-6 md:p-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ApiKeyGate({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState('');
  const save = () => {
    if (!value.trim()) return;
    setApiKey(value.trim());
    onSaved();
  };
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" /> WAMux Manager
          </CardTitle>
          <CardDescription>
            Cole a <b>GLOBAL_API_KEY</b> do WAMux para gerenciar as instâncias.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="password"
            placeholder="GLOBAL_API_KEY"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            autoFocus
          />
          <Button className="w-full" disabled={!value.trim()} onClick={save}>
            Entrar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
