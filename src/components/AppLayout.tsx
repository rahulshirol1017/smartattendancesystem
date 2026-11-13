import React, { useState } from 'react';
import { Bell, ChevronDown, LogOut, Menu, X } from 'lucide-react';
import {
  AppNotification,
  InstitutionalPolicy,
  NavigationSection,
  UserProfile,
} from '../shared/types.ts';
import { VtuEmblemLogo } from './VtuEmblemLogo.tsx';

interface AppLayoutProps {
  user: UserProfile;
  policy: InstitutionalPolicy;
  storageMode: 'mongodb' | 'local_sandbox';
  activeSection: NavigationSection;
  onNavigate: (section: NavigationSection) => void;
  notifications: AppNotification[];
  onMarkNotificationsRead: (id?: string) => void;
  onSwitchPortal: () => void;
  onLogout: () => void;
  pendingCorrectionsCount: number;
  children: React.ReactNode;
}

const STUDENT_NAV_ORDER: NavigationSection[] = [
  'dashboard',
  'qr-attendance',
  'my-attendance',
  'subject-reports',
  'timetable',
  'corrections',
  'reports',
  'profile',
];

const FACULTY_NAV_ORDER: NavigationSection[] = [
  'dashboard',
  'qr-attendance',
  'my-attendance',
  'timetable',
  'subject-reports',
  'corrections',
  'reports',
  'profile',
];

const ADMIN_NAV_ORDER: NavigationSection[] = [
  'dashboard',
  'admin-attendance-monitoring',
  'admin-students',
  'admin-faculty',
  'admin-sections',
  'admin-subjects',
  'admin-timetable',
  'admin-extra-classes',
  'my-attendance',
  'corrections',
  'reports',
  'profile',
];

export const AppLayout: React.FC<AppLayoutProps> = ({
  user,
  policy,
  activeSection,
  onNavigate,
  notifications,
  onMarkNotificationsRead,
  onSwitchPortal,
  onLogout,
  pendingCorrectionsCount,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const navItems =
    user.role === 'admin'
      ? ADMIN_NAV_ORDER
      : user.role === 'faculty'
        ? FACULTY_NAV_ORDER
        : STUDENT_NAV_ORDER;

  const isNavItemActive = (sec: NavigationSection): boolean => {
    if (activeSection === sec) return true;
    if (sec === 'admin-subjects' && activeSection === 'admin-assignments') return true;
    if (sec === 'reports' && activeSection === 'admin-audit-logs') return true;
    return false;
  };

  const getNavLabel = (sec: NavigationSection): string => {
    if (user.role === 'admin') {
      switch (sec) {
        case 'dashboard':
          return 'Dashboard';
        case 'admin-attendance-monitoring':
          return 'Live Monitoring';
        case 'admin-students':
          return 'Students';
        case 'admin-faculty':
          return 'Faculty';
        case 'admin-sections':
          return 'Sections';
        case 'admin-subjects':
          return 'Courses';
        case 'admin-timetable':
          return 'Timetable';
        case 'admin-extra-classes':
          return 'Extra Classes';
        case 'my-attendance':
          return 'Attendance';
        case 'corrections':
          return 'Evidence Review';
        case 'reports':
          return 'Reports';
        case 'profile':
          return 'Settings';
        default:
          return 'Dashboard';
      }
    }

    if (user.role === 'faculty') {
      switch (sec) {
        case 'dashboard':
          return 'Dashboard';
        case 'qr-attendance':
          return 'QR Attendance';
        case 'my-attendance':
          return 'Mark Attendance';
        case 'timetable':
          return 'Timetable';
        case 'subject-reports':
          return 'Class Rosters';
        case 'corrections':
          return 'Evidence Review';
        case 'reports':
          return 'Reports';
        case 'profile':
          return 'Profile';
        default:
          return 'Dashboard';
      }
    }

    switch (sec) {
      case 'dashboard':
        return 'Dashboard';
      case 'qr-attendance':
        return 'Scan Attendance';
      case 'my-attendance':
        return 'My Attendance';
      case 'subject-reports':
        return 'Course Records';
      case 'timetable':
        return 'Timetable';
      case 'corrections':
        return 'Evidence Upload';
      case 'reports':
        return 'Reports';
      case 'profile':
        return 'Profile';
      default:
        return 'Dashboard';
    }
  };

  const getHeaderContext = (): string => {
    if (user.role === 'student') {
      const secText = user.sectionDisplayName ? `${user.sectionDisplayName} · ` : '';
      return `${secText}V Semester · ${policy.academicYear}`;
    }
    if (user.role === 'faculty') {
      return `Dept. of CSE (${user.department}) · ${policy.academicYear}`;
    }
    return `CSBS Academic Office · ${policy.academicYear}`;
  };

  return (
    <div className="min-h-screen flex bg-[#FAF3E3] text-[#241710]">
      {/* Desktop Sidebar: VTU Forest Green (#165B33) with Saffron-Orange (#DF6A24) active state */}
      <aside className="no-print hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 bg-[#165B33] text-white">
        <div className="flex items-center gap-3 px-5 h-16 border-b border-white/15 shrink-0">
          <VtuEmblemLogo size="sm" />
          <div className="min-w-0">
            <div className="font-display text-sm font-semibold text-white truncate">
              VTU Attendance
            </div>
            <div className="text-xs text-white/75 truncate capitalize">
              {user.role === 'admin' ? 'Administration' : `${user.role} Portal`}
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Main navigation">
          {navItems.map((sec) => {
            const isActive = isNavItemActive(sec);
            const showCount = sec === 'corrections' && pendingCorrectionsCount > 0;
            return (
              <button
                key={sec}
                type="button"
                onClick={() => onNavigate(sec)}
                className={`w-full flex items-center justify-between gap-2 rounded px-3 py-2 text-sm transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#DF6A24] text-white font-medium'
                    : 'text-white/85 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="truncate">{getNavLabel(sec)}</span>
                {showCount && (
                  <span
                    className={`font-mono text-xs font-semibold tabular-nums shrink-0 ${
                      isActive ? 'text-white' : 'text-[#DF6A24]'
                    }`}
                  >
                    {pendingCorrectionsCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/15 text-xs space-y-2">
          <div className="font-medium text-white truncate">{user.name}</div>
          <div className="font-mono text-[11px] text-white/75 truncate">
            {user.identifier}
            {user.sectionDisplayName ? ` · ${user.sectionDisplayName}` : ''}
          </div>
          <button
            type="button"
            onClick={onSwitchPortal}
            className="mt-1 w-full inline-flex items-center justify-center gap-1.5 rounded border border-white/25 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-[#241710]/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 flex w-64 max-w-[80vw] flex-col bg-[#165B33] text-white">
            <div className="flex items-center justify-between px-4 h-14 border-b border-white/15">
              <div className="flex items-center gap-2.5">
                <VtuEmblemLogo size="sm" />
                <span className="font-display text-sm font-semibold text-white">
                  VTU Attendance
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded text-white/85 hover:bg-white/10"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
              {navItems.map((sec) => {
                const isActive = isNavItemActive(sec);
                return (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => {
                      onNavigate(sec);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 rounded px-3 py-2 text-sm whitespace-nowrap ${
                      isActive
                        ? 'bg-[#DF6A24] text-white font-medium'
                        : 'text-white/85 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className="truncate">{getNavLabel(sec)}</span>
                    {sec === 'corrections' && pendingCorrectionsCount > 0 && (
                      <span className="font-mono text-xs text-white tabular-nums">
                        {pendingCorrectionsCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-white/15">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onSwitchPortal();
                }}
                className="w-full rounded border border-white/25 px-3 py-2 text-xs font-medium text-white hover:bg-white/10"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-60">
        <header className="no-print sticky top-0 z-30 h-14 bg-[#FFFDF8] border-b border-[#E3D2B4] px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden rounded p-1.5 text-[#165B33] hover:bg-[#FAF3E3]"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-medium text-[#6B5A4C] truncate">
              {getHeaderContext()}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Notices Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((prev) => !prev);
                  setProfileOpen(false);
                }}
                className="inline-flex items-center gap-1.5 rounded border border-[#E3D2B4] bg-white px-2.5 py-1.5 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3] whitespace-nowrap shrink-0"
                aria-label={`Notices (${unreadCount} unread)`}
              >
                <Bell className="h-4 w-4 text-[#165B33]" />
                <span>Notices</span>
                {unreadCount > 0 && (
                  <span className="font-mono text-xs font-semibold text-[#DF6A24] tabular-nums">
                    ({unreadCount})
                  </span>
                )}
              </button>

              {notifOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setNotifOpen(false)}
                  />
                  <div className="absolute right-0 mt-1.5 z-40 w-80 sm:w-96 rounded-md border border-[#E3D2B4] bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-[#E3D2B4] px-4 py-3">
                      <span className="text-sm font-semibold text-[#165B33]">Notices</span>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={() => onMarkNotificationsRead()}
                          className="text-xs font-medium text-[#DF6A24] hover:underline whitespace-nowrap"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-[#E3D2B4]">
                      {notifications.length === 0 ? (
                        <div className="p-4 text-xs text-[#6B5A4C]">No notices.</div>
                      ) : (
                        notifications.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => {
                              onMarkNotificationsRead(n.id);
                              if (n.targetNav) onNavigate(n.targetNav);
                              setNotifOpen(false);
                            }}
                            className={`w-full text-left px-4 py-3 hover:bg-[#FAF3E3] transition-colors ${
                              !n.read ? 'bg-[#FFFDF8]' : 'bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-[#165B33]">
                                {n.title}
                              </span>
                              <span className="font-mono text-[11px] text-[#6B5A4C] shrink-0">
                                {n.timestamp.slice(0, 10)}
                              </span>
                            </div>
                            <p className="text-xs text-[#241710] mt-1 leading-relaxed">
                              {n.message}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Account Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileOpen((prev) => !prev);
                  setNotifOpen(false);
                }}
                className="inline-flex items-center gap-2 rounded border border-[#E3D2B4] bg-white px-3 py-1.5 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3] whitespace-nowrap shrink-0"
              >
                <span className="max-w-[140px] truncate">{user.name}</span>
                <ChevronDown className="h-3.5 w-3.5 text-[#6B5A4C]" />
              </button>

              {profileOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setProfileOpen(false)}
                  />
                  <div className="absolute right-0 mt-1.5 z-40 w-60 rounded-md border border-[#E3D2B4] bg-white shadow-sm divide-y divide-[#E3D2B4]">
                    <div className="px-4 py-3">
                      <div className="text-sm font-semibold text-[#165B33]">{user.name}</div>
                      <div className="font-mono text-xs text-[#6B5A4C] mt-0.5">
                        {user.identifier}
                      </div>
                    </div>
                    <div className="py-1">
                      <button
                        type="button"
                        onClick={() => {
                          setProfileOpen(false);
                          onNavigate('profile');
                        }}
                        className="w-full text-left px-4 py-2 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3]"
                      >
                        {user.role === 'admin' ? 'Settings' : 'Profile'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setProfileOpen(false);
                          onSwitchPortal();
                        }}
                        className="w-full text-left px-4 py-2 text-xs font-medium text-[#DF6A24] hover:bg-[#FAF3E3]"
                      >
                        Switch account
                      </button>
                    </div>
                    <div className="py-1">
                      <button
                        type="button"
                        onClick={() => {
                          setProfileOpen(false);
                          onLogout();
                        }}
                        className="w-full text-left px-4 py-2 text-xs font-medium text-[#B42318] hover:bg-[#FAF3E3]"
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1160px] w-full mx-auto print-container">
          {children}
        </main>

        <footer className="no-print border-t border-[#E3D2B4] bg-[#FFFDF8] px-4 sm:px-6 lg:px-8 py-4 mt-8">
          <div className="max-w-[1160px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-[#6B5A4C]">
            <div>{policy.institutionName}</div>
            <div className="whitespace-nowrap">Smart Attendance System</div>
          </div>
        </footer>
      </div>
    </div>
  );
};
