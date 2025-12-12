import React from 'react';
import {
  Dashboard as DashboardIcon,
  Storage as StorageIcon,
  Description as DocumentIcon,
  Chat as ChatIcon,
  Group as GroupIcon,
  Settings as SettingsIcon,
  BugReport as TestIcon,
  List as ListIcon,
  LibraryBooks as TemplateIcon,
  People as UsersIcon,
  Business as BusinessIcon,
  Security as PermissionsIcon,
} from '@mui/icons-material';

export type NavIcon = React.ComponentType<any>;

export interface NavItem {
  key: string;
  path: string;
  translationKey: string;
  icon: NavIcon;
  showInTopBar?: boolean;
  showInSidebar?: boolean;
  requiredRole?: string;
}

export const mainNavItems: NavItem[] = [
  { key: 'dashboard', path: '/', translationKey: 'nav.dashboard', icon: DashboardIcon, showInTopBar: true, showInSidebar: true },
  { key: 'knowledgeBases', path: '/knowledge-bases', translationKey: 'nav.knowledgeBases', icon: StorageIcon, showInTopBar: true, showInSidebar: true },
  { key: 'documents', path: '/documents', translationKey: 'nav.documents', icon: DocumentIcon, showInTopBar: true, showInSidebar: true },
  { key: 'chat', path: '/chat', translationKey: 'nav.chat', icon: ChatIcon, showInTopBar: true, showInSidebar: true },
  { key: 'teams', path: '/teams', translationKey: 'nav.teams', icon: GroupIcon, showInTopBar: true, showInSidebar: true },
  { key: 'settings', path: '/settings', translationKey: 'nav.settings', icon: SettingsIcon, showInTopBar: false, showInSidebar: true },
  { key: 'connectionTest', path: '/test', translationKey: 'nav.connectionTest', icon: TestIcon, requiredRole: 'tenant_admin', showInTopBar: true, showInSidebar: true },
];

export const workflowNavItems: NavItem[] = [
  { key: 'workflowManage', path: '/workflows', translationKey: 'nav.workflow.manage', icon: ListIcon, showInTopBar: true, showInSidebar: true },
  { key: 'workflowTemplates', path: '/workflows/templates', translationKey: 'nav.workflow.templates', icon: TemplateIcon, showInTopBar: true, showInSidebar: true },
];

export const adminNavItems: NavItem[] = [
  { key: 'userManagement', path: '/users', translationKey: 'nav.userManagement', icon: UsersIcon, requiredRole: 'tenant_admin', showInTopBar: true, showInSidebar: true },
  { key: 'tenantManagement', path: '/tenants', translationKey: 'nav.tenantManagement', icon: BusinessIcon, requiredRole: 'super_admin', showInTopBar: true, showInSidebar: true },
  { key: 'permissionManagement', path: '/permissions', translationKey: 'nav.permissionManagement', icon: PermissionsIcon, requiredRole: 'super_admin', showInTopBar: true, showInSidebar: true },
];
