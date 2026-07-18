import {
  Hexagon,
  Inbox,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  TerminalSquare,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { clearApiKey } from '@/api';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar';

const NAV: { path: string; label: string; icon: typeof LayoutDashboard }[] = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/instances', label: 'Instâncias', icon: MessageSquare },
  { path: '/inbox', label: 'Inbox', icon: Inbox },
  { path: '/playground', label: 'Playground', icon: TerminalSquare },
  { path: '/settings', label: 'Configurações', icon: Settings },
];

export function AppSidebar({ onLogout }: { onLogout: () => void }) {
  const { pathname } = useLocation();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Hexagon className="size-5" />
          </div>
          <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-display text-sm font-semibold">WAMux</span>
            <span className="text-xs text-muted-foreground">WhatsApp Multiplexer</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.path}
                    tooltip={item.label}
                    className="transition-colors hover:[&>svg]:text-primary data-[active=true]:border-l-2 data-[active=true]:border-primary data-[active=true]:pl-1.5 [&[data-active=true]>svg]:text-primary"
                  >
                    <NavLink to={item.path}>
                      <item.icon />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Trocar API key"
              onClick={() => {
                clearApiKey();
                onLogout();
              }}
            >
              <LogOut />
              <span>Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
