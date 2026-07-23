import {
  FileText,
  Hexagon,
  Inbox,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  ScrollText,
  Settings,
  Sprout,
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

interface NavItem {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
}

/**
 * Navegação agrupada por área: Visão geral (métricas), Operação (o que você
 * opera no dia a dia: números, aquecimento e conversas), Ferramentas (montar
 * templates / testar a API) e Sistema (auditoria + configuração).
 */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Visão geral',
    items: [{ path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Operação',
    items: [
      { path: '/instances', label: 'Instâncias', icon: MessageSquare },
      { path: '/maturation', label: 'Maturação', icon: Sprout },
      { path: '/inbox', label: 'Inbox', icon: Inbox },
    ],
  },
  {
    label: 'Ferramentas',
    items: [
      { path: '/templates', label: 'Templates', icon: FileText },
      { path: '/playground', label: 'Playground', icon: TerminalSquare },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { path: '/logs', label: 'Logs', icon: ScrollText },
      { path: '/settings', label: 'Configurações', icon: Settings },
    ],
  },
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
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
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
        ))}
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
