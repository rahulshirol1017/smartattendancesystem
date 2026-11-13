import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, BootstrapPayload, PublicMetaPayload } from './api/client.ts';
import { AppLayout } from './components/AppLayout.tsx';
import { computeOverallSummary, computeSubjectAttendance } from './shared/attendanceMath.ts';
import { NavigationSection, UserRole } from './shared/types.ts';
import {
  AdminAssignmentsView,
  AdminAuditLogsView,
  AdminExtraClassesView,
  AdminSectionsView,
  AdminSubjectsView,
  AdminTimetableView,
} from './views/AdminAcademicViews.tsx';
import { AdminFacultyView, AdminStudentsView } from './views/AdminPeopleViews.tsx';
import { AuthPage } from './views/AuthPage.tsx';
import { CorrectionsView } from './views/CorrectionsView.tsx';
import { DashboardView } from './views/DashboardView.tsx';
import { HeroPage } from './views/HeroPage.tsx';
import { MyAttendanceView } from './views/MyAttendanceView.tsx';
import { ProfileSettingsView } from './views/ProfileSettingsView.tsx';
import { ReportsHistoryView } from './views/ReportsHistoryView.tsx';
import { SubjectReportsView } from './views/SubjectReportsView.tsx';
import { TimetableView } from './views/TimetableView.tsx';
import { QRScannerModal } from './components/QRScannerModal.tsx';
import { FacultyQRAttendanceView } from './views/FacultyQRAttendanceView.tsx';
import { AdminAttendanceMonitoringView } from './views/AdminAttendanceMonitoringView.tsx';

function getDomainRoutePath(role: UserRole, section: NavigationSection): string {
  const slug = role === 'admin' && section === 'dashboard' ? 'overview' : section;
  return `/${role}/${slug}`;
}

export default function App() {
  const [workspace, setWorkspace] = useState<BootstrapPayload | null>(null);
  const [publicMeta, setPublicMeta] = useState<PublicMetaPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [publicRoute, setPublicRoute] = useState<'hero' | 'auth'>(() => {
    const path = window.location.pathname.toLowerCase();
    return path === '/auth' || path === '/login' ? 'auth' : 'hero';
  });
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register'>('login');

  const [activeSection, setActiveSection] = useState<NavigationSection>('dashboard');
  const [focusedSubjectId, setFocusedSubjectId] = useState<string | null>(null);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [preselectedCorrectionRecordId, setPreselectedCorrectionRecordId] = useState<
    string | null
  >(null);

  const [isScanModalOpen, setIsScanModalOpen] = useState<boolean>(false);

  const [adminSubjectsTab, setAdminSubjectsTab] = useState<'subjects' | 'assignments'>('subjects');
  const [adminReportsTab, setAdminReportsTab] = useState<'reports' | 'audit'>('reports');

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname.toLowerCase();
      if (path === '/auth' || path === '/login') {
        setPublicRoute('auth');
      } else if (path === '/' || path === '') {
        setPublicRoute('hero');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigatePublicRoute = useCallback(
    (target: 'hero' | 'auth', mode: 'login' | 'register' = 'login') => {
      setAuthInitialMode(mode);
      setPublicRoute(target);
      try {
        const nextUrl = target === 'auth' ? '/auth' : '/';
        if (window.location.pathname !== nextUrl) {
          window.history.pushState(null, '', nextUrl);
        }
      } catch {
        // Ignore history restrictions in sandboxed iframes
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    []
  );

  const syncDomainUrl = useCallback((role: UserRole, section: NavigationSection) => {
    try {
      const targetPath = getDomainRoutePath(role, section);
      if (window.location.pathname !== targetPath) {
        window.history.replaceState(null, '', targetPath);
      }
    } catch {
      // Ignore history restrictions
    }
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    setLoadError(null);
    try {
      const [meta, session] = await Promise.all([api.getPublicMeta(), api.getSession()]);
      setPublicMeta(meta);

      if (session.user) {
        const boot = await api.getBootstrap();
        setWorkspace(boot);
        syncDomainUrl(boot.user.role, 'dashboard');
      } else {
        setWorkspace(null);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Unable to connect to the attendance server.'
      );
    } finally {
      setLoading(false);
    }
  }, [syncDomainUrl]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  useEffect(() => {
    if (workspace) {
      syncDomainUrl(workspace.user.role, activeSection);
    }
  }, [workspace, activeSection, syncDomainUrl]);

  const handleSectionNavigate = useCallback(
    (sec: NavigationSection) => {
      if (sec === 'qr-attendance' && workspace?.user.role === 'student') {
        setIsScanModalOpen(true);
        return;
      } else if (sec === 'admin-assignments') {
        setAdminSubjectsTab('assignments');
        setActiveSection('admin-subjects');
      } else if (sec === 'admin-subjects') {
        setAdminSubjectsTab('subjects');
        setActiveSection('admin-subjects');
      } else if (sec === 'admin-audit-logs') {
        setAdminReportsTab('audit');
        setActiveSection('reports');
      } else if (sec === 'reports') {
        setAdminReportsTab('reports');
        setActiveSection('reports');
      } else {
        setActiveSection(sec);
      }
      if (workspace) {
        syncDomainUrl(workspace.user.role, sec);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [workspace, syncDomainUrl]
  );

  const subjectMetrics = useMemo(() => {
    if (!workspace || workspace.user.role !== 'student') return [];
    return workspace.subjects.map((subj) =>
      computeSubjectAttendance(
        subj,
        workspace.classes,
        workspace.records,
        workspace.timetable,
        workspace.policy,
        workspace.user.sectionId
      )
    );
  }, [workspace]);

  const overallSummary = useMemo(
    () => computeOverallSummary(subjectMetrics),
    [subjectMetrics]
  );

  const pendingCorrectionsCount = useMemo(() => {
    if (!workspace) return 0;
    return workspace.corrections.filter(
      (c) =>
        c.workflowStatus === 'Submitted' ||
        c.workflowStatus === 'Under Review' ||
        c.workflowStatus === 'Additional Evidence Requested'
    ).length;
  }, [workspace]);

  const handleOpenSubjectReport = (subjectId: string) => {
    setFocusedSubjectId(subjectId);
    setActiveSection('subject-reports');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenSessionForAttendance = (sessionId: string) => {
    setFocusedSessionId(sessionId);
    setActiveSection('my-attendance');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStartCorrectionForRecord = (recordId: string) => {
    setPreselectedCorrectionRecordId(recordId);
    setActiveSection('corrections');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleMarkNotificationsRead = async (id?: string) => {
    await api.markNotificationsRead(id);
    await loadWorkspaceData();
  };

  const handleLogoutToHero = async () => {
    await api.logout();
    setWorkspace(null);
    setActiveSection('dashboard');
    navigatePublicRoute('hero', 'login');
  };

  const handleSwitchPortalAccount = async () => {
    await api.logout();
    setWorkspace(null);
    setActiveSection('dashboard');
    navigatePublicRoute('auth', 'login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF3E3] flex items-center justify-center p-6">
        <div className="w-full max-w-3xl space-y-4">
          <div className="h-7 w-56 rounded bg-[#E3D2B4]/60 animate-pulse" />
          <div className="h-32 w-full rounded-md border border-[#E3D2B4] bg-white p-6 space-y-3">
            <div className="h-4 w-48 rounded bg-[#E3D2B4]/60 animate-pulse" />
            <div className="grid grid-cols-3 gap-4 pt-3">
              <div className="h-10 rounded bg-[#FAF3E3] animate-pulse" />
              <div className="h-10 rounded bg-[#FAF3E3] animate-pulse" />
              <div className="h-10 rounded bg-[#FAF3E3] animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#FAF3E3] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-md border border-[#E3D2B4] bg-white p-6 space-y-4">
          <div className="text-base font-semibold text-[#165B33]">
            Could not load the portal
          </div>
          <p className="text-sm text-[#6B5A4C]">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              loadWorkspaceData();
            }}
            className="inline-flex items-center gap-2 rounded bg-[#165B33] px-4 py-2 text-sm font-medium text-white hover:bg-[#104526]"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Try again</span>
          </button>
        </div>
      </div>
    );
  }

  if (!workspace) {
    if (publicRoute === 'hero') {
      return (
        <HeroPage onNavigateToAuth={() => navigatePublicRoute('auth', 'login')} />
      );
    }

    return (
      <AuthPage
        initialMode={authInitialMode}
        sections={publicMeta?.sections || []}
        institutionName={publicMeta?.institutionName}
        onBackToHero={() => navigatePublicRoute('hero', 'login')}
        onLogin={async (idOrEmail, pass) => {
          const loggedInUser = await api.login(idOrEmail, pass);
          setActiveSection('dashboard');
          const boot = await api.getBootstrap();
          setWorkspace(boot);
          syncDomainUrl(loggedInUser.role, 'dashboard');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onRegister={async (payload) => {
          const registeredUser = await api.register(payload);
          setActiveSection('dashboard');
          const boot = await api.getBootstrap();
          setWorkspace(boot);
          syncDomainUrl(registeredUser.role, 'dashboard');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  return (
    <AppLayout
      user={workspace.user}
      policy={workspace.policy}
      storageMode={workspace.storageMode}
      activeSection={activeSection}
      onNavigate={handleSectionNavigate}
      notifications={workspace.notifications}
      onMarkNotificationsRead={handleMarkNotificationsRead}
      onSwitchPortal={handleSwitchPortalAccount}
      onLogout={handleLogoutToHero}
      pendingCorrectionsCount={pendingCorrectionsCount}
    >
      {activeSection === 'dashboard' && (
        <DashboardView
          user={workspace.user}
          policy={workspace.policy}
          sections={workspace.sections}
          facultyAssignments={workspace.facultyAssignments}
          subjectMetrics={subjectMetrics}
          overallSummary={overallSummary}
          subjects={workspace.subjects}
          classes={workspace.classes}
          records={workspace.records}
          corrections={workspace.corrections}
          timetable={workspace.timetable}
          cohortUsers={workspace.cohortUsers}
          activeQrSessions={workspace.activeQrSessions}
          onOpenScanModal={() => setIsScanModalOpen(true)}
          onOpenSubjectReport={handleOpenSubjectReport}
          onOpenSessionForAttendance={handleOpenSessionForAttendance}
          onNavigate={handleSectionNavigate}
        />
      )}

      {activeSection === 'my-attendance' && (
        <MyAttendanceView
          user={workspace.user}
          policy={workspace.policy}
          sections={workspace.sections}
          facultyAssignments={workspace.facultyAssignments}
          timetable={workspace.timetable}
          subjects={workspace.subjects}
          classes={workspace.classes}
          records={workspace.records}
          corrections={workspace.corrections}
          auditLogs={workspace.auditLogs}
          subjectMetrics={subjectMetrics}
          cohortUsers={workspace.cohortUsers}
          focusedSessionId={focusedSessionId}
          onClearFocusedSession={() => setFocusedSessionId(null)}
          onStartCorrectionForRecord={handleStartCorrectionForRecord}
          onOpenSubjectReport={handleOpenSubjectReport}
          onRefreshWorkspace={loadWorkspaceData}
        />
      )}

      {activeSection === 'subject-reports' && (
        <SubjectReportsView
          user={workspace.user}
          policy={workspace.policy}
          sections={workspace.sections}
          facultyAssignments={workspace.facultyAssignments}
          subjects={workspace.subjects}
          subjectMetrics={subjectMetrics}
          classes={workspace.classes}
          records={workspace.records}
          corrections={workspace.corrections}
          auditLogs={workspace.auditLogs}
          timetable={workspace.timetable}
          cohortUsers={workspace.cohortUsers}
          initialSubjectId={focusedSubjectId}
          onStartCorrectionForRecord={handleStartCorrectionForRecord}
        />
      )}

      {activeSection === 'corrections' && (
        <CorrectionsView
          user={workspace.user}
          policy={workspace.policy}
          subjects={workspace.subjects}
          classes={workspace.classes}
          records={workspace.records}
          corrections={workspace.corrections}
          preselectedRecordId={preselectedCorrectionRecordId}
          onClearPreselectedRecord={() => setPreselectedCorrectionRecordId(null)}
          onRefreshWorkspace={loadWorkspaceData}
        />
      )}

      {activeSection === 'timetable' && (
        <TimetableView
          user={workspace.user}
          policy={workspace.policy}
          sections={workspace.sections}
          classes={workspace.classes}
          timetable={workspace.timetable}
          subjectMetrics={subjectMetrics}
          onOpenSessionForAttendance={handleOpenSessionForAttendance}
        />
      )}

      {activeSection === 'reports' && (
        <div className="space-y-5">
          {workspace.user.role === 'admin' && (
            <div className="flex items-center justify-between border-b border-[#E3D2B4] pb-3 no-print">
              <h1 className="text-xl font-semibold text-[#165B33]">Reports</h1>
              <div className="inline-flex rounded bg-[#FFFDF8] p-1 border border-[#E3D2B4]">
                <button
                  type="button"
                  onClick={() => setAdminReportsTab('reports')}
                  className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                    adminReportsTab === 'reports'
                      ? 'bg-[#DF6A24] text-white'
                      : 'text-[#6B5A4C] hover:text-[#241710]'
                  }`}
                >
                  Attendance Statement
                </button>
                <button
                  type="button"
                  onClick={() => setAdminReportsTab('audit')}
                  className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                    adminReportsTab === 'audit'
                      ? 'bg-[#DF6A24] text-white'
                      : 'text-[#6B5A4C] hover:text-[#241710]'
                  }`}
                >
                  Audit Log
                </button>
              </div>
            </div>
          )}

          {workspace.user.role === 'admin' && adminReportsTab === 'audit' ? (
            <AdminAuditLogsView auditLogs={workspace.auditLogs} />
          ) : (
            <ReportsHistoryView
              user={workspace.user}
              policy={workspace.policy}
              sections={workspace.sections}
              facultyAssignments={workspace.facultyAssignments}
              subjects={workspace.subjects}
              classes={workspace.classes}
              records={workspace.records}
              corrections={workspace.corrections}
              auditLogs={workspace.auditLogs}
              timetable={workspace.timetable}
              cohortUsers={workspace.cohortUsers}
            />
          )}
        </div>
      )}

      {activeSection === 'profile' && (
        <ProfileSettingsView
          user={workspace.user}
          policy={workspace.policy}
          storageMode={workspace.storageMode}
          subjects={workspace.subjects}
          cohortUsers={workspace.cohortUsers}
          onSwitchPortal={handleSwitchPortalAccount}
          onRefreshWorkspace={loadWorkspaceData}
        />
      )}

      {/* ADMINISTRATOR SECTIONS */}
      {workspace.user.role === 'admin' && activeSection === 'admin-students' && (
        <AdminStudentsView
          policy={workspace.policy}
          sections={workspace.sections}
          subjects={workspace.subjects}
          facultyAssignments={workspace.facultyAssignments}
          classes={workspace.classes}
          records={workspace.records}
          corrections={workspace.corrections}
          timetable={workspace.timetable}
          cohortUsers={workspace.cohortUsers}
          onRefreshWorkspace={loadWorkspaceData}
        />
      )}

      {workspace.user.role === 'admin' && activeSection === 'admin-faculty' && (
        <AdminFacultyView
          facultyAssignments={workspace.facultyAssignments}
          timetable={workspace.timetable}
          cohortUsers={workspace.cohortUsers}
          onNavigate={handleSectionNavigate}
          onRefreshWorkspace={loadWorkspaceData}
        />
      )}

      {workspace.user.role === 'admin' && activeSection === 'admin-sections' && (
        <AdminSectionsView
          sections={workspace.sections}
          facultyAssignments={workspace.facultyAssignments}
          timetable={workspace.timetable}
          cohortUsers={workspace.cohortUsers}
          onRefreshWorkspace={loadWorkspaceData}
        />
      )}

      {workspace.user.role === 'admin' &&
        (activeSection === 'admin-subjects' || activeSection === 'admin-assignments') && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E3D2B4] pb-3">
              <h1 className="text-xl font-semibold text-[#165B33]">Courses & Faculty Allocation</h1>
              <div className="inline-flex rounded bg-[#FFFDF8] p-1 border border-[#E3D2B4] self-start">
                <button
                  type="button"
                  onClick={() => setAdminSubjectsTab('subjects')}
                  className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                    adminSubjectsTab === 'subjects'
                      ? 'bg-[#DF6A24] text-white'
                      : 'text-[#6B5A4C] hover:text-[#241710]'
                  }`}
                >
                  Courses
                </button>
                <button
                  type="button"
                  onClick={() => setAdminSubjectsTab('assignments')}
                  className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                    adminSubjectsTab === 'assignments'
                      ? 'bg-[#DF6A24] text-white'
                      : 'text-[#6B5A4C] hover:text-[#241710]'
                  }`}
                >
                  Section Teachers
                </button>
              </div>
            </div>

            {adminSubjectsTab === 'assignments' ? (
              <AdminAssignmentsView
                sections={workspace.sections}
                subjects={workspace.subjects}
                facultyAssignments={workspace.facultyAssignments}
                cohortUsers={workspace.cohortUsers}
                onRefreshWorkspace={loadWorkspaceData}
              />
            ) : (
              <AdminSubjectsView
                policy={workspace.policy}
                subjects={workspace.subjects}
                facultyAssignments={workspace.facultyAssignments}
                cohortUsers={workspace.cohortUsers}
                onRefreshWorkspace={loadWorkspaceData}
              />
            )}
          </div>
        )}

      {workspace.user.role === 'admin' && activeSection === 'admin-timetable' && (
        <AdminTimetableView
          policy={workspace.policy}
          sections={workspace.sections}
          facultyAssignments={workspace.facultyAssignments}
          timetable={workspace.timetable}
          cohortUsers={workspace.cohortUsers}
          onRefreshWorkspace={loadWorkspaceData}
        />
      )}

      {workspace.user.role === 'admin' && activeSection === 'admin-extra-classes' && (
        <AdminExtraClassesView
          policy={workspace.policy}
          sections={workspace.sections}
          subjects={workspace.subjects}
          facultyAssignments={workspace.facultyAssignments}
          classes={workspace.classes}
          timetable={workspace.timetable}
          cohortUsers={workspace.cohortUsers}
          onRefreshWorkspace={loadWorkspaceData}
        />
      )}

      {workspace.user.role === 'admin' && activeSection === 'admin-audit-logs' && (
        <AdminAuditLogsView auditLogs={workspace.auditLogs} />
      )}

      {/* Dynamic QR Attendance Session Generator (Faculty / Admin) */}
      {activeSection === 'qr-attendance' && (
        <FacultyQRAttendanceView
          user={workspace.user}
          policy={workspace.policy}
          facultyAssignments={workspace.facultyAssignments}
          subjects={workspace.subjects}
          classes={workspace.classes}
          cohortUsers={workspace.cohortUsers}
          onSessionUpdated={loadWorkspaceData}
        />
      )}

      {/* Real-time Campus Geofence & Anti-Proxy Monitoring (Admin) */}
      {workspace.user.role === 'admin' && activeSection === 'admin-attendance-monitoring' && (
        <AdminAttendanceMonitoringView
          user={workspace.user}
          policy={workspace.policy}
          onPolicyUpdated={(updated) => {
            setWorkspace((prev) => (prev ? { ...prev, policy: updated } : null));
          }}
        />
      )}

      {/* Student Time & Location Verified QR Scanner Modal */}
      <QRScannerModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        user={workspace.user}
        policy={workspace.policy}
        activeSession={workspace.activeQrSessions?.[0]}
        onSuccess={() => {
          loadWorkspaceData();
        }}
      />
    </AppLayout>
  );
}
