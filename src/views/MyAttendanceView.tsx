import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Search,
  QrCode,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  UserCheck,
  RefreshCw,
  Sparkles,
  ArrowRight,
  ShieldAlert,
  Check,
} from 'lucide-react';
import { api, ApiRequestError } from '../api/client.ts';
import { RecordStatusIndicator, StandingIndicator } from '../components/StatusIndicator.tsx';
import { validateSessionConflicts } from '../shared/conflictCheck.ts';
import {
  AcademicSection,
  AttendanceAuditLog,
  AttendanceCorrectionRequest,
  AttendanceRecord,
  CentralizedAttendanceRosterItem,
  CentralizedAttendanceSummary,
  ClassSession,
  ClassSessionType,
  ConflictDetail,
  FacultyAssignment,
  InstitutionalPolicy,
  NavigationSection,
  QRAttendanceSession,
  RecordSource,
  SubjectAttendanceComputed,
  SubjectItem,
  TimetableEntry,
  UserProfile,
} from '../shared/types.ts';

interface MyAttendanceViewProps {
  user: UserProfile;
  policy: InstitutionalPolicy;
  sections: AcademicSection[];
  facultyAssignments: FacultyAssignment[];
  timetable: TimetableEntry[];
  subjects: SubjectItem[];
  classes: ClassSession[];
  records: AttendanceRecord[];
  corrections: AttendanceCorrectionRequest[];
  auditLogs: AttendanceAuditLog[];
  subjectMetrics: SubjectAttendanceComputed[];
  cohortUsers: UserProfile[];
  focusedSessionId?: string | null;
  onClearFocusedSession?: () => void;
  onStartCorrectionForRecord: (recordId: string) => void;
  onOpenSubjectReport: (subjectId: string) => void;
  onRefreshWorkspace: () => Promise<void>;
  onNavigate?: (section: NavigationSection) => void;
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export const MyAttendanceView: React.FC<MyAttendanceViewProps> = ({
  user,
  policy,
  sections,
  facultyAssignments,
  timetable,
  subjects,
  classes,
  records,
  subjectMetrics,
  cohortUsers,
  focusedSessionId,
  onClearFocusedSession,
  onStartCorrectionForRecord,
  onOpenSubjectReport,
  onRefreshWorkspace,
  onNavigate,
}) => {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    () => subjectMetrics[0]?.subject.id || subjects[0]?.id || ''
  );

  useEffect(() => {
    if (!selectedSubjectId && subjectMetrics.length > 0) {
      setSelectedSubjectId(subjectMetrics[0].subject.id);
    }
  }, [subjectMetrics, selectedSubjectId]);

  const selectedMetric = useMemo(
    () =>
      subjectMetrics.find((m) => m.subject.id === selectedSubjectId) ||
      subjectMetrics[0] ||
      null,
    [subjectMetrics, selectedSubjectId]
  );

  const recentRecordsForSelected = useMemo(() => {
    if (user.role !== 'student' || !selectedMetric) return [];
    const sessionMap = new Map<string, ClassSession>(classes.map((c) => [c.id, c]));
    return records
      .filter((r) => r.subjectId === selectedMetric.subject.id)
      .map((rec) => ({
        rec,
        session: sessionMap.get(rec.classId),
      }))
      .filter(
        (item): item is { rec: AttendanceRecord; session: ClassSession } => Boolean(item.session)
      )
      .sort((a, b) =>
        `${b.session.date}T${b.session.startTime}`.localeCompare(
          `${a.session.date}T${a.session.startTime}`
        )
      )
      .slice(0, 8);
  }, [user.role, selectedMetric, records, classes]);

  const [facultyTab, setFacultyTab] = useState<'scheduled' | 'unscheduled' | 'extra'>('scheduled');

  const markableSessions = useMemo(() => {
    if (user.role === 'student') return [];
    const subjectMap = new Map<string, SubjectItem>(subjects.map((s) => [s.id, s]));
    const filtered = classes.filter((c) => {
      if (c.status === 'Cancelled' || c.status === 'Rescheduled') return false;
      if (c.approvalStatus !== 'Approved') return false;
      if (user.role === 'admin') return true;
      return c.facultyId === user.id || c.scheduledFacultyId === user.id;
    });

    return filtered
      .map((c) => ({
        ...c,
        resolvedSubjectName: c.subjectName || subjectMap.get(c.subjectId)?.name || 'Class',
        resolvedSubjectCode: c.subjectCode || subjectMap.get(c.subjectId)?.code || '',
      }))
      .sort((a, b) => {
        const aOpen = !a.attendanceSubmitted ? 0 : 1;
        const bOpen = !b.attendanceSubmitted ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`);
      });
  }, [user, classes, subjects]);

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [topicDraft, setTopicDraft] = useState<string>('');
  const [studentSearch, setStudentSearch] = useState<string>('');
  const [rollDraft, setRollDraft] = useState<Record<string, 'Present' | 'Absent' | 'Excused'>>({});
  const [savingAttendance, setSavingAttendance] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Centralized Attendance Management state
  const [centralizedRoster, setCentralizedRoster] = useState<CentralizedAttendanceRosterItem[]>([]);
  const [centralizedSummary, setCentralizedSummary] = useState<CentralizedAttendanceSummary | null>(null);
  const [activeQrSession, setActiveQrSession] = useState<QRAttendanceSession | null>(null);
  const [updatingStudentId, setUpdatingStudentId] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState<boolean>(false);
  const [isLaunchingQr, setIsLaunchingQr] = useState<boolean>(false);
  const [isPollingActive, setIsPollingActive] = useState<boolean>(true);

  useEffect(() => {
    if (focusedSessionId) {
      setFacultyTab('scheduled');
      setSelectedSessionId(focusedSessionId);
      if (onClearFocusedSession) onClearFocusedSession();
    } else if (!selectedSessionId && markableSessions.length > 0) {
      setSelectedSessionId(markableSessions[0].id);
    }
  }, [focusedSessionId, markableSessions, selectedSessionId, onClearFocusedSession]);

  const currentSession = useMemo(
    () => markableSessions.find((s) => s.id === selectedSessionId) || markableSessions[0] || null,
    [markableSessions, selectedSessionId]
  );

  const sectionStudents = useMemo(() => {
    if (!currentSession) return [];
    return cohortUsers
      .filter(
        (u) =>
          u.role === 'student' &&
          u.sectionId === currentSession.sectionId &&
          u.accountStatus === 'Active'
      )
      .sort((a, b) => a.identifier.localeCompare(b.identifier));
  }, [cohortUsers, currentSession]);

  // Real-time Centralized Attendance Polling (3s interval)
  const loadCentralizedData = useCallback(async (classId: string) => {
    try {
      const res = await api.getClassAttendance(classId);
      setCentralizedRoster(res.roster);
      setCentralizedSummary(res.summary);
      setActiveQrSession(res.qrSession || null);
    } catch {
      // Quiet fallback if session not yet created
    }
  }, []);

  useEffect(() => {
    if (user.role === 'student' || !currentSession?.id) return;
    loadCentralizedData(currentSession.id);

    const interval = window.setInterval(() => {
      loadCentralizedData(currentSession.id);
    }, 3000);

    return () => clearInterval(interval);
  }, [user.role, currentSession?.id, loadCentralizedData]);

  // Sync draft roll from records/centralizedRoster
  useEffect(() => {
    if (!currentSession) return;
    setTopicDraft(currentSession.topic || '');
    const nextRoll: Record<string, 'Present' | 'Absent' | 'Excused'> = {};
    if (centralizedRoster.length > 0) {
      for (const item of centralizedRoster) {
        if (item.status !== 'Pending') {
          nextRoll[item.studentId] = item.status;
        } else {
          nextRoll[item.studentId] = 'Present';
        }
      }
    } else {
      const existingForSession = new Map<string, AttendanceRecord>();
      for (const r of records) {
        if (r.classId === currentSession.id) {
          existingForSession.set(r.studentId, r);
        }
      }
      for (const stu of sectionStudents) {
        const rec = existingForSession.get(stu.id);
        if (rec) {
          nextRoll[stu.id] =
            rec.status === 'Absent'
              ? 'Absent'
              : rec.status === 'Excused'
              ? 'Excused'
              : 'Present';
        } else {
          nextRoll[stu.id] = 'Present';
        }
      }
    }
    setRollDraft(nextRoll);
  }, [currentSession, records, sectionStudents, centralizedRoster]);

  // Unified roster displayed to faculty
  const displayRoster = useMemo(() => {
    let list = centralizedRoster;
    if (list.length === 0 && sectionStudents.length > 0) {
      list = sectionStudents.map((stu) => {
        const existing = records.find(
          (r) => r.studentId === stu.id && r.classId === currentSession?.id
        );
        const status = existing
          ? (existing.status as 'Present' | 'Absent' | 'Excused')
          : 'Pending';
        const recordSource = existing?.recordSource;
        const verificationMethod: 'QR' | 'Manual' | 'None' =
          recordSource === 'QR Geoverified'
            ? 'QR'
            : recordSource === 'Faculty Register'
            ? 'Manual'
            : 'None';
        return {
          studentId: stu.id,
          studentName: stu.name,
          studentIdentifier: stu.identifier,
          sectionDisplayName: stu.sectionDisplayName || currentSession?.sectionDisplayName || '',
          record: existing,
          status,
          recordSource,
          timestamp: existing?.timestamp,
          recordedByName: existing?.recordedByName,
          verificationMethod,
        } as CentralizedAttendanceRosterItem;
      });
    }

    const q = studentSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.studentName.toLowerCase().includes(q) || s.studentIdentifier.toLowerCase().includes(q)
    );
  }, [centralizedRoster, sectionStudents, records, currentSession, studentSearch]);

  const visibleStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return sectionStudents;
    return sectionStudents.filter(
      (s) => s.name.toLowerCase().includes(q) || s.identifier.toLowerCase().includes(q)
    );
  }, [sectionStudents, studentSearch]);

  const allowedAssignments = useMemo(() => {
    const active = facultyAssignments.filter((fa) => fa.status === 'Active');
    if (user.role === 'admin') return active;
    return active.filter((fa) => fa.facultyId === user.id);
  }, [facultyAssignments, user]);

  const [manualAssignmentId, setManualAssignmentId] = useState<string>(
    () => allowedAssignments[0]?.id || ''
  );
  const [manualDate, setManualDate] = useState<string>('2026-10-27');
  const [manualPeriod, setManualPeriod] = useState<string>('Slot 1 (09:00 - 10:00)');
  const [manualStart, setManualStart] = useState<string>('09:00');
  const [manualEnd, setManualEnd] = useState<string>('10:00');
  const [manualRoom, setManualRoom] = useState<string>('VB G19');
  const [manualTopic, setManualTopic] = useState<string>('');
  const [manualRoll, setManualRoll] = useState<Record<string, 'Present' | 'Absent' | 'Excused'>>(
    {}
  );

  const selectedManualAssignment = useMemo(
    () =>
      allowedAssignments.find((a) => a.id === manualAssignmentId) || allowedAssignments[0] || null,
    [allowedAssignments, manualAssignmentId]
  );

  const manualStudents = useMemo(() => {
    if (!selectedManualAssignment) return [];
    return cohortUsers
      .filter(
        (u) =>
          u.role === 'student' &&
          u.sectionId === selectedManualAssignment.sectionId &&
          u.accountStatus === 'Active'
      )
      .sort((a, b) => a.identifier.localeCompare(b.identifier));
  }, [cohortUsers, selectedManualAssignment]);

  useEffect(() => {
    const sec = sections.find((s) => s.id === selectedManualAssignment?.sectionId);
    if (sec?.defaultClassroom) setManualRoom(sec.defaultClassroom);
    const next: Record<string, 'Present' | 'Absent' | 'Excused'> = {};
    for (const st of manualStudents) next[st.id] = 'Present';
    setManualRoll(next);
  }, [selectedManualAssignment, manualStudents, sections]);

  const [extraAssignmentId, setExtraAssignmentId] = useState<string>(
    () => allowedAssignments[0]?.id || ''
  );
  const [extraType, setExtraType] = useState<ClassSessionType>('Extra');
  const [extraDate, setExtraDate] = useState<string>('2026-10-29');
  const [extraPeriod, setExtraPeriod] = useState<string>('Extra Slot (15:15 - 16:15)');
  const [extraStart, setExtraStart] = useState<string>('15:15');
  const [extraEnd, setExtraEnd] = useState<string>('16:15');
  const [extraRoom, setExtraRoom] = useState<string>('VB G19');
  const [extraTopic, setExtraTopic] = useState<string>('');
  const [extraConflicts, setExtraConflicts] = useState<ConflictDetail[]>([]);

  const selectedExtraAssignment = useMemo(
    () =>
      allowedAssignments.find((a) => a.id === extraAssignmentId) || allowedAssignments[0] || null,
    [allowedAssignments, extraAssignmentId]
  );

  useEffect(() => {
    const sec = sections.find((s) => s.id === selectedExtraAssignment?.sectionId);
    if (sec?.defaultClassroom) setExtraRoom(sec.defaultClassroom);
  }, [selectedExtraAssignment, sections]);

  useEffect(() => {
    if (!selectedExtraAssignment) {
      setExtraConflicts([]);
      return;
    }
    const facultyProfile =
      cohortUsers.find((u) => u.id === selectedExtraAssignment.facultyId) || user;
    const conflicts = validateSessionConflicts({
      candidate: {
        sectionId: selectedExtraAssignment.sectionId,
        date: extraDate,
        startTime: extraStart,
        endTime: extraEnd,
        classroom: extraRoom,
        actualFacultyId: selectedExtraAssignment.facultyId,
      },
      existingSessions: classes,
      existingTimetable: timetable,
      facultyUser: facultyProfile,
      checkRooms: policy.enforceRoomConflictCheck,
    });
    setExtraConflicts(conflicts);
  }, [
    selectedExtraAssignment,
    extraDate,
    extraStart,
    extraEnd,
    extraRoom,
    classes,
    timetable,
    cohortUsers,
    user,
    policy.enforceRoomConflictCheck,
  ]);

  // ============================================================================
  // 1. STUDENT VIEW: MY ATTENDANCE (STRICTLY FACTUAL, ZERO COACHING EXPLANATIONS)
  // ============================================================================
  if (user.role === 'student') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#165B33]">My Attendance</h1>
          <p className="mt-1 text-sm text-[#6B5A4C]">
            {user.sectionDisplayName || `CSBS ${user.section}`} · Semester {user.semester}
          </p>
        </div>

        <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                <th className="py-3 px-4">Course</th>
                <th className="py-3 px-4">Attended</th>
                <th className="py-3 px-4">Attendance</th>
                <th className="py-3 px-4">Required</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3D2B4] text-sm">
              {subjectMetrics.map((m) => {
                const isSelected = selectedMetric?.subject.id === m.subject.id;
                const pctText = m.percentage !== null ? `${Math.round(m.percentage)}%` : '—';
                return (
                  <tr
                    key={m.subject.id}
                    onClick={() => setSelectedSubjectId(m.subject.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#DF6A24]/10' : 'hover:bg-[#FAF3E3]/55'
                    }`}
                  >
                    <td className="py-3.5 px-4">
                      <div
                        className={`font-medium ${
                          isSelected ? 'text-[#165B33]' : 'text-[#241710]'
                        }`}
                      >
                        {m.subject.name}
                      </div>
                      <div className="text-xs text-[#6B5A4C] font-mono mt-0.5">
                        {m.subject.code}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 tabular-nums text-[#241710] whitespace-nowrap">
                      {m.attended} / {m.conducted}
                    </td>
                    <td className="py-3.5 px-4 tabular-nums font-medium text-[#241710] whitespace-nowrap">
                      {pctText}
                    </td>
                    <td className="py-3.5 px-4 tabular-nums text-[#6B5A4C] whitespace-nowrap">
                      {m.requiredPercentage}%
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <StandingIndicator standing={m.standing} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selectedMetric && (
          <section className="rounded-md border border-[#E3D2B4] bg-white p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[#E3D2B4] pb-4">
              <div>
                <h2 className="text-lg font-semibold text-[#165B33]">
                  {selectedMetric.subject.name}
                </h2>
                <p className="text-xs text-[#6B5A4C] mt-0.5">
                  <span className="font-mono">{selectedMetric.subject.code}</span> ·{' '}
                  {selectedMetric.subject.assignedFacultyName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenSubjectReport(selectedMetric.subject.id)}
                className="self-start rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3.5 py-1.5 text-xs font-medium text-[#165B33] hover:bg-[#FAF3E3]"
              >
                View all class dates
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-[#6B5A4C]">Classes Attended</div>
                <div className="mt-1 text-base font-semibold text-[#241710] tabular-nums">
                  {selectedMetric.attended} / {selectedMetric.conducted}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#6B5A4C]">Attendance</div>
                <div className="mt-1 text-base font-semibold text-[#165B33] tabular-nums">
                  {selectedMetric.percentage !== null
                    ? `${Math.round(selectedMetric.percentage)}%`
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#6B5A4C]">Minimum Required</div>
                <div className="mt-1 text-base font-semibold text-[#241710] tabular-nums">
                  {selectedMetric.requiredPercentage}%
                </div>
              </div>
            </div>

            {recentRecordsForSelected.length > 0 && (
              <div className="space-y-2.5 pt-1">
                <h3 className="text-sm font-semibold text-[#165B33]">Recent Sessions</h3>
                <div className="overflow-x-auto rounded border border-[#E3D2B4]">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                        <th className="py-2.5 px-3.5">Date</th>
                        <th className="py-2.5 px-3.5">Time</th>
                        <th className="py-2.5 px-3.5">Topic</th>
                        <th className="py-2.5 px-3.5">Status</th>
                        <th className="py-2.5 px-3.5 text-right">Evidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E3D2B4] text-sm">
                      {recentRecordsForSelected.map(({ rec, session }) => (
                        <tr key={rec.id} className="hover:bg-[#FAF3E3]/55">
                          <td className="py-2.5 px-3.5 whitespace-nowrap tabular-nums text-[#241710]">
                            {formatShortDate(session.date)}
                          </td>
                          <td className="py-2.5 px-3.5 whitespace-nowrap tabular-nums text-[#6B5A4C]">
                            {session.startTime} – {session.endTime}
                          </td>
                          <td className="py-2.5 px-3.5 text-[#241710]">{session.topic}</td>
                          <td className="py-2.5 px-3.5 whitespace-nowrap">
                            <RecordStatusIndicator
                              status={rec.status}
                              hasPendingCorrection={Boolean(rec.pendingRequestId)}
                            />
                          </td>
                          <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            {rec.status === 'Absent' && !rec.pendingRequestId ? (
                              <button
                                type="button"
                                onClick={() => onStartCorrectionForRecord(rec.id)}
                                className="text-xs font-medium text-[#DF6A24] hover:underline"
                              >
                                Upload Evidence
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    );
  }

  // ============================================================================
  // 2. FACULTY & ADMIN ATTENDANCE MARKING VIEW
  // ============================================================================
  const handleToggleSingleStatus = async (
    studentId: string,
    status: 'Present' | 'Absent' | 'Excused'
  ) => {
    if (!currentSession) return;
    setUpdatingStudentId(studentId);
    setFeedback(null);
    try {
      // Optimistic update
      setCentralizedRoster((prev) =>
        prev.map((item) =>
          item.studentId === studentId
            ? {
                ...item,
                status,
                recordSource: 'Faculty Register' as RecordSource,
                verificationMethod: 'Manual',
                timestamp: new Date().toISOString(),
                conflictAlert: undefined,
              }
            : item
        )
      );

      const res = await api.updateSingleAttendance({
        classId: currentSession.id,
        studentId,
        status,
      });

      setCentralizedRoster(res.roster);
      setCentralizedSummary(res.summary);
      if (res.conflictDetected) {
        setFeedback({
          type: 'error',
          text: res.conflictReason || 'Conflict flagged for review.',
        });
      } else {
        setFeedback({
          type: 'success',
          text: `Marked ${status.toUpperCase()} manually. Saved to official register.`,
        });
      }
      await onRefreshWorkspace();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update student attendance.',
      });
      if (currentSession) loadCentralizedData(currentSession.id);
    } finally {
      setUpdatingStudentId(null);
    }
  };

  const handleLaunchQr = async () => {
    if (!currentSession) return;
    setIsLaunchingQr(true);
    setFeedback(null);
    try {
      const { session } = await api.createQrSession({
        classId: currentSession.id,
        sectionId: currentSession.sectionId,
        subjectId: currentSession.subjectId,
        classroom: currentSession.classroom,
      });
      setActiveQrSession(session);
      setFeedback({
        type: 'success',
        text: `Dynamic QR attendance session launched for ${currentSession.resolvedSubjectCode}. QR rotates every 5s.`,
      });
      if (onNavigate) {
        onNavigate('qr-attendance');
      } else {
        await loadCentralizedData(currentSession.id);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to launch QR attendance session.',
      });
    } finally {
      setIsLaunchingQr(false);
    }
  };

  const handleFinalizeClass = async () => {
    if (!currentSession) return;
    const pendingCount = centralizedSummary?.pendingCount ?? 0;
    const confirmMsg = `Finalize attendance for ${currentSession.resolvedSubjectCode} (${currentSession.sectionDisplayName})?\n\n${
      pendingCount > 0
        ? `${pendingCount} pending/unrecorded students will be officially recorded as ABSENT.`
        : 'All students are recorded. The official register will be marked conducted.'
    }`;
    if (!window.confirm(confirmMsg)) return;

    setIsFinalizing(true);
    setFeedback(null);
    try {
      const res = await api.finalizeClassAttendance({ classId: currentSession.id });
      setCentralizedRoster(res.roster);
      setCentralizedSummary(res.summary);
      setActiveQrSession(null);
      setFeedback({
        type: 'success',
        text: `Class attendance finalized. ${res.finalizedCount} pending students marked Absent. Official records locked in MongoDB.`,
      });
      await onRefreshWorkspace();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to finalize class attendance.',
      });
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleMarkAllPresent = async () => {
    if (!currentSession) return;
    setSavingAttendance(true);
    setFeedback(null);
    try {
      const payload = displayRoster.map((stu) => ({
        studentId: stu.studentId,
        status: 'Present' as const,
      }));
      await api.submitSessionAttendance(currentSession.id, {
        topic: topicDraft.trim() || currentSession.topic,
        attendance: payload,
      });
      await loadCentralizedData(currentSession.id);
      await onRefreshWorkspace();
      setFeedback({ type: 'success', text: 'All students marked Present in official register.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not mark all present.',
      });
    } finally {
      setSavingAttendance(false);
    }
  };

  const handleMarkAllAbsent = async () => {
    if (!currentSession) return;
    setSavingAttendance(true);
    setFeedback(null);
    try {
      const payload = displayRoster.map((stu) => ({
        studentId: stu.studentId,
        status: 'Absent' as const,
      }));
      await api.submitSessionAttendance(currentSession.id, {
        topic: topicDraft.trim() || currentSession.topic,
        attendance: payload,
      });
      await loadCentralizedData(currentSession.id);
      await onRefreshWorkspace();
      setFeedback({ type: 'success', text: 'All students marked Absent in official register.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not mark all absent.',
      });
    } finally {
      setSavingAttendance(false);
    }
  };

  const handleSaveScheduledAttendance = async () => {
    if (!currentSession) return;
    setSavingAttendance(true);
    setFeedback(null);
    try {
      const payload = displayRoster.map((stu) => ({
        studentId: stu.studentId,
        status: (stu.status === 'Pending' ? 'Present' : stu.status) as 'Present' | 'Absent' | 'Excused',
      }));
      await api.submitSessionAttendance(currentSession.id, {
        topic: topicDraft.trim() || currentSession.topic,
        attendance: payload,
      });
      await loadCentralizedData(currentSession.id);
      await onRefreshWorkspace();
      setFeedback({ type: 'success', text: 'Attendance register saved to MongoDB.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not save attendance.',
      });
    } finally {
      setSavingAttendance(false);
    }
  };

  const handleSaveManualSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedManualAssignment) return;
    setSavingAttendance(true);
    setFeedback(null);
    try {
      await api.recordClassSession({
        sectionId: selectedManualAssignment.sectionId,
        subjectId: selectedManualAssignment.subjectId,
        date: manualDate,
        period: manualPeriod,
        startTime: manualStart,
        endTime: manualEnd,
        topic: manualTopic.trim() || 'Class lecture',
        classroom: manualRoom.trim() || 'VB G19',
        status: 'Conducted',
        attendance: manualStudents.map((stu) => ({
          studentId: stu.id,
          status: manualRoll[stu.id] || 'Present',
        })),
      });
      await onRefreshWorkspace();
      setManualTopic('');
      setFeedback({ type: 'success', text: 'Class session and attendance saved.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not record class session.',
      });
    } finally {
      setSavingAttendance(false);
    }
  };

  const handleScheduleExtraClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExtraAssignment) return;
    setSavingAttendance(true);
    setFeedback(null);
    try {
      await api.createExtraClass({
        sectionId: selectedExtraAssignment.sectionId,
        subjectId: selectedExtraAssignment.subjectId,
        sessionType: extraType,
        date: extraDate,
        period: extraPeriod,
        startTime: extraStart,
        endTime: extraEnd,
        classroom: extraRoom,
        topic: extraTopic.trim() || `${extraType} session`,
        actualFacultyId: selectedExtraAssignment.facultyId,
        reason: 'Scheduled academic session',
      });
      await onRefreshWorkspace();
      setExtraTopic('');
      setFeedback({ type: 'success', text: 'Extra class scheduled.' });
    } catch (err) {
      if (err instanceof ApiRequestError && err.conflicts) {
        setExtraConflicts(err.conflicts);
      }
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not schedule extra class.',
      });
    } finally {
      setSavingAttendance(false);
    }
  };

  const presentCount = sectionStudents.filter(
    (s) => (rollDraft[s.id] || 'Present') === 'Present'
  ).length;
  const absentCount = sectionStudents.filter((s) => rollDraft[s.id] === 'Absent').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E3D2B4] pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#165B33]">Mark Attendance</h1>
          <p className="mt-1 text-sm text-[#6B5A4C]">
            Select an assigned CSBS session and record student attendance.
          </p>
        </div>

        <div className="inline-flex rounded border border-[#E3D2B4] bg-[#FFFDF8] p-1 self-start">
          <button
            type="button"
            onClick={() => {
              setFacultyTab('scheduled');
              setFeedback(null);
            }}
            className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              facultyTab === 'scheduled'
                ? 'bg-[#DF6A24] text-white'
                : 'text-[#6B5A4C] hover:text-[#241710]'
            }`}
          >
            Scheduled Classes
          </button>
          <button
            type="button"
            onClick={() => {
              setFacultyTab('unscheduled');
              setFeedback(null);
            }}
            className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              facultyTab === 'unscheduled'
                ? 'bg-[#DF6A24] text-white'
                : 'text-[#6B5A4C] hover:text-[#241710]'
            }`}
          >
            New Session
          </button>
          {(user.role === 'admin' || policy.allowFacultyExtraClassRequests) && (
            <button
              type="button"
              onClick={() => {
                setFacultyTab('extra');
                setFeedback(null);
              }}
              className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                facultyTab === 'extra'
                  ? 'bg-[#DF6A24] text-white'
                  : 'text-[#6B5A4C] hover:text-[#241710]'
              }`}
            >
              Extra Class
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-md border px-4 py-3 text-sm bg-white ${
            feedback.type === 'success'
              ? 'border-[#165B33]/40 text-[#165B33]'
              : 'border-[#B42318]/40 text-[#B42318]'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {facultyTab === 'scheduled' && (
        <div className="space-y-5">
          {/* Active Dynamic QR Beacon Banner */}
          {activeQrSession && activeQrSession.status === 'ACTIVE' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-emerald-300 bg-emerald-50/70 p-3.5 text-emerald-950">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-600"></span>
                </span>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                    Live Dynamic QR Session Active
                  </div>
                  <div className="text-xs text-emerald-700">
                    Cryptographic QR rotating every 5s · Students scanning phone camera appear below live without refresh
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate && onNavigate('qr-attendance')}
                className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 transition-colors shadow-sm"
              >
                <QrCode className="w-3.5 h-3.5" />
                View Fullscreen QR Display
              </button>
            </div>
          )}

          {/* Class Session Selector & Topic Covered */}
          <div className="rounded-md border border-[#E3D2B4] bg-white p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Class Session (Centralized Roster)
                </label>
                <select
                  value={currentSession?.id || ''}
                  onChange={(e) => {
                    setSelectedSessionId(e.target.value);
                    setFeedback(null);
                  }}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
                >
                  {markableSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatShortDate(s.date)} · {s.startTime}–{s.endTime} · {s.sectionDisplayName}{' '}
                      — {s.resolvedSubjectCode} {s.resolvedSubjectName} (
                      {s.attendanceSubmitted ? 'Conducted' : 'Open'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Topic Covered
                </label>
                <input
                  type="text"
                  value={topicDraft}
                  onChange={(e) => setTopicDraft(e.target.value)}
                  placeholder="Enter lecture or lab topic"
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
                />
              </div>
            </div>

            {currentSession && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#E3D2B4] pt-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                  <span>
                    <span className="text-[#6B5A4C]">Course:</span>{' '}
                    <strong className="font-semibold text-[#165B33]">
                      {currentSession.resolvedSubjectCode} · {currentSession.resolvedSubjectName}
                    </strong>
                  </span>
                  <span>
                    <span className="text-[#6B5A4C]">Section:</span>{' '}
                    <strong className="font-semibold text-[#241710]">
                      {currentSession.sectionDisplayName}
                    </strong>
                  </span>
                  <span>
                    <span className="text-[#6B5A4C]">Slot:</span>{' '}
                    <span className="font-medium text-[#241710] tabular-nums">
                      {formatShortDate(currentSession.date)}, {currentSession.startTime} –{' '}
                      {currentSession.endTime} ({currentSession.classroom})
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs text-[#6B5A4C]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>Live 3s Polling Active</span>
                </div>
              </div>
            )}
          </div>

          {/* Centralized Attendance Live Summary Cards */}
          {currentSession && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="rounded-md border border-[#E3D2B4] bg-white p-3">
                <div className="text-[11px] font-semibold text-[#6B5A4C] uppercase tracking-wider">
                  Total Enrolled
                </div>
                <div className="mt-1 text-2xl font-bold text-[#241710] tabular-nums">
                  {centralizedSummary?.totalEnrolled ?? sectionStudents.length}
                </div>
                <div className="text-[10px] text-[#6B5A4C] mt-0.5">Official section cohort</div>
              </div>

              <div className="rounded-md border border-emerald-300 bg-emerald-50/50 p-3">
                <div className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider">
                  Present
                </div>
                <div className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">
                  {centralizedSummary?.presentCount ?? 0}
                </div>
                <div className="text-[10px] text-emerald-700/80 mt-0.5">QR verified + manual</div>
              </div>

              <div className="rounded-md border border-rose-300 bg-rose-50/50 p-3">
                <div className="text-[11px] font-semibold text-rose-800 uppercase tracking-wider">
                  Absent
                </div>
                <div className="mt-1 text-2xl font-bold text-rose-700 tabular-nums">
                  {centralizedSummary?.absentCount ?? 0}
                </div>
                <div className="text-[10px] text-rose-700/80 mt-0.5">Official absences</div>
              </div>

              <div className="rounded-md border border-amber-300 bg-amber-50/50 p-3">
                <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">
                  Excused
                </div>
                <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">
                  {centralizedSummary?.excusedCount ?? 0}
                </div>
                <div className="text-[10px] text-amber-700/80 mt-0.5">Institutional leave</div>
              </div>

              <div className="rounded-md border border-slate-300 bg-slate-50/70 p-3">
                <div className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                  Pending
                </div>
                <div className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">
                  {centralizedSummary?.pendingCount ?? sectionStudents.length}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Awaiting QR / roll-call</div>
              </div>

              <div className="rounded-md border border-[#E3D2B4] bg-[#FFFDF8] p-3 flex flex-col justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-[#165B33] uppercase tracking-wider">
                    Completion
                  </div>
                  <div className="mt-1 text-2xl font-bold text-[#165B33] tabular-nums">
                    {centralizedSummary?.completionPercentage ?? 0}%
                  </div>
                </div>
                <div className="w-full bg-[#E3D2B4]/40 rounded-full h-1.5 mt-2 overflow-hidden">
                  <div
                    className="bg-[#165B33] h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${centralizedSummary?.completionPercentage ?? 0}%` }}
                  ></div>
                </div>
              </div>
            </div>
          )}

          {currentSession ? (
            <div className="space-y-3">
              {/* Toolbar & Action Buttons */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="relative w-full lg:w-72">
                  <Search className="w-4 h-4 text-[#6B5A4C] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="Search student name or USN"
                    className="w-full rounded border border-[#E3D2B4] bg-white pl-9 pr-3 py-2 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isLaunchingQr}
                    onClick={handleLaunchQr}
                    className="inline-flex items-center gap-1.5 rounded bg-[#165B33] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#104526] disabled:opacity-50 transition-colors shadow-sm whitespace-nowrap"
                  >
                    <QrCode className="w-4 h-4" />
                    {isLaunchingQr ? 'Starting QR…' : 'Launch Dynamic QR for this Class'}
                  </button>

                  <button
                    type="button"
                    disabled={isFinalizing}
                    onClick={handleFinalizeClass}
                    className="inline-flex items-center gap-1.5 rounded border border-[#DF6A24] bg-[#FFFDF8] px-3 py-2 text-xs font-semibold text-[#DF6A24] hover:bg-[#FAF3E3] disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {isFinalizing ? 'Finalizing…' : 'Finalize Class (Mark Pending as Absent)'}
                  </button>

                  <button
                    type="button"
                    disabled={savingAttendance}
                    onClick={handleMarkAllPresent}
                    className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3 py-2 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3] whitespace-nowrap"
                  >
                    Mark All Present
                  </button>

                  <button
                    type="button"
                    disabled={savingAttendance}
                    onClick={handleMarkAllAbsent}
                    className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3 py-2 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3] whitespace-nowrap"
                  >
                    Mark All Absent
                  </button>
                </div>
              </div>

              {/* Centralized Attendance Register Table */}
              <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                      <th className="py-3 px-4 w-36">USN</th>
                      <th className="py-3 px-4">Student Name</th>
                      <th className="py-3 px-4 hidden md:table-cell">Section</th>
                      <th className="py-3 px-4">Current Status</th>
                      <th className="py-3 px-4">Recording Method</th>
                      <th className="py-3 px-4 hidden sm:table-cell">Marked Time</th>
                      <th className="py-3 px-4 text-right">Register Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3D2B4] text-sm">
                    {displayRoster.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 px-4 text-center text-[#6B5A4C]">
                          No students found matching your criteria.
                        </td>
                      </tr>
                    ) : (
                      displayRoster.map((item) => {
                        const isUpdating = updatingStudentId === item.studentId;
                        const status = item.status;
                        const formattedTime = item.timestamp
                          ? new Date(item.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })
                          : '—';

                        return (
                          <tr key={item.studentId} className="hover:bg-[#FAF3E3]/40 transition-colors">
                            {/* USN */}
                            <td className="py-3 px-4 font-mono text-xs font-bold text-[#241710] whitespace-nowrap">
                              {item.studentIdentifier}
                            </td>

                            {/* Student Name & Conflict Warning */}
                            <td className="py-3 px-4">
                              <div className="font-semibold text-[#241710]">{item.studentName}</div>
                              {item.conflictAlert && (
                                <div className="mt-1 text-[11px] text-amber-900 bg-amber-50 border border-amber-300 rounded px-2 py-0.5 flex items-center justify-between gap-2">
                                  <span className="flex items-center gap-1 font-medium">
                                    <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
                                    {item.conflictAlert}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleSingleStatus(item.studentId, 'Present')}
                                    className="text-[11px] font-bold text-emerald-800 underline hover:text-emerald-950"
                                  >
                                    Accept QR (Mark Present)
                                  </button>
                                </div>
                              )}
                            </td>

                            {/* Section */}
                            <td className="py-3 px-4 text-xs text-[#6B5A4C] hidden md:table-cell whitespace-nowrap">
                              {item.sectionDisplayName}
                            </td>

                            {/* Current Status Badge */}
                            <td className="py-3 px-4 whitespace-nowrap">
                              {status === 'Present' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  PRESENT
                                </span>
                              )}
                              {status === 'Absent' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">
                                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                  ABSENT
                                </span>
                              )}
                              {status === 'Excused' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                  EXCUSED
                                </span>
                              )}
                              {status === 'Pending' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-dashed border-slate-300">
                                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                                  NOT RECORDED
                                </span>
                              )}
                            </td>

                            {/* Recording Method Badge */}
                            <td className="py-3 px-4 whitespace-nowrap">
                              {item.verificationMethod === 'QR' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  <QrCode className="w-3.5 h-3.5 text-emerald-600" />
                                  QR VERIFIED
                                </span>
                              )}
                              {item.verificationMethod === 'Manual' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide bg-blue-50 text-blue-800 border border-blue-200">
                                  <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                                  MANUAL
                                </span>
                              )}
                              {item.verificationMethod === 'None' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-slate-400 bg-slate-50 border border-slate-200">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  PENDING
                                </span>
                              )}
                            </td>

                            {/* Marked Time */}
                            <td className="py-3 px-4 text-xs font-mono text-[#6B5A4C] hidden sm:table-cell whitespace-nowrap">
                              {formattedTime}
                            </td>

                            {/* Register Actions (3-way toggle) */}
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex rounded border border-[#E3D2B4] bg-[#FAF3E3] p-0.5">
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => handleToggleSingleStatus(item.studentId, 'Present')}
                                  className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                                    status === 'Present'
                                      ? 'bg-[#165B33] text-white shadow-sm'
                                      : 'text-[#6B5A4C] hover:text-[#241710]'
                                  } disabled:opacity-50`}
                                >
                                  Present
                                </button>
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => handleToggleSingleStatus(item.studentId, 'Absent')}
                                  className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                                    status === 'Absent'
                                      ? 'bg-[#B42318] text-white shadow-sm'
                                      : 'text-[#6B5A4C] hover:text-[#241710]'
                                  } disabled:opacity-50`}
                                >
                                  Absent
                                </button>
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => handleToggleSingleStatus(item.studentId, 'Excused')}
                                  className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                                    status === 'Excused'
                                      ? 'bg-[#DF6A24] text-white shadow-sm'
                                      : 'text-[#6B5A4C] hover:text-[#241710]'
                                  } disabled:opacity-50`}
                                >
                                  Excused
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-[#E3D2B4] bg-white p-6 text-sm text-[#6B5A4C]">
              No scheduled classes found.
            </div>
          )}
        </div>
      )}

      {facultyTab === 'unscheduled' && (
        <form onSubmit={handleSaveManualSession} className="space-y-5">
          <div className="rounded-md border border-[#E3D2B4] bg-white p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                Section & Course
              </label>
              <select
                value={selectedManualAssignment?.id || ''}
                onChange={(e) => setManualAssignmentId(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              >
                {allowedAssignments.map((fa) => (
                  <option key={fa.id} value={fa.id}>
                    {fa.sectionDisplayName} — {fa.subjectCode} {fa.subjectName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Date</label>
              <input
                type="date"
                required
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Slot Label</label>
              <input
                type="text"
                required
                value={manualPeriod}
                onChange={(e) => setManualPeriod(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Start Time</label>
              <input
                type="time"
                required
                value={manualStart}
                onChange={(e) => setManualStart(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">End Time</label>
              <input
                type="time"
                required
                value={manualEnd}
                onChange={(e) => setManualEnd(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Room</label>
              <input
                type="text"
                required
                value={manualRoom}
                onChange={(e) => setManualRoom(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Topic Covered</label>
              <input
                type="text"
                required
                value={manualTopic}
                onChange={(e) => setManualTopic(e.target.value)}
                placeholder="Enter lecture or lab topic"
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[#165B33]">
              Student Roll ({manualStudents.length})
            </span>
            <button
              type="submit"
              disabled={savingAttendance || manualStudents.length === 0}
              className="rounded bg-[#165B33] px-4 py-2 text-sm font-medium text-white hover:bg-[#104526] disabled:opacity-50"
            >
              {savingAttendance ? 'Saving…' : 'Save Attendance'}
            </button>
          </div>

          <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                  <th className="py-3 px-4 w-44">USN</th>
                  <th className="py-3 px-4">Student Name</th>
                  <th className="py-3 px-4 text-right">Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3D2B4] text-sm">
                {manualStudents.map((stu) => {
                  const st = manualRoll[stu.id] || 'Present';
                  return (
                    <tr key={stu.id} className="hover:bg-[#FAF3E3]/55">
                      <td className="py-3 px-4 font-mono text-xs text-[#241710]">
                        {stu.identifier}
                      </td>
                      <td className="py-3 px-4 font-medium text-[#241710]">{stu.name}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex rounded border border-[#E3D2B4] bg-[#FAF3E3] p-0.5">
                          {(['Present', 'Absent', 'Excused'] as const).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() =>
                                setManualRoll((prev) => ({ ...prev, [stu.id]: opt }))
                              }
                              className={`rounded px-3 py-1 text-xs font-medium ${
                                st === opt
                                  ? opt === 'Present'
                                    ? 'bg-[#165B33] text-white'
                                    : opt === 'Absent'
                                    ? 'bg-[#B42318] text-white'
                                    : 'bg-[#DF6A24] text-white'
                                  : 'text-[#6B5A4C] hover:text-[#241710]'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}

      {facultyTab === 'extra' && (
        <form
          onSubmit={handleScheduleExtraClass}
          className="rounded-md border border-[#E3D2B4] bg-white p-5 space-y-4 max-w-3xl"
        >
          <h2 className="text-base font-semibold text-[#165B33]">Schedule Extra Class</h2>

          {extraConflicts.length > 0 && (
            <div className="rounded border border-[#B42318]/40 bg-[#FFFDF8] p-3 text-xs text-[#B42318] space-y-1">
              {extraConflicts.map((c, idx) => (
                <div key={idx}>• {c.message}</div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                Section & Course
              </label>
              <select
                value={selectedExtraAssignment?.id || ''}
                onChange={(e) => setExtraAssignmentId(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              >
                {allowedAssignments.map((fa) => (
                  <option key={fa.id} value={fa.id}>
                    {fa.sectionDisplayName} — {fa.subjectCode} {fa.subjectName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Class Type</label>
              <select
                value={extraType}
                onChange={(e) => setExtraType(e.target.value as ClassSessionType)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              >
                <option value="Extra">Extra Class</option>
                <option value="Replacement">Make-up Class</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Date</label>
              <input
                type="date"
                required
                value={extraDate}
                onChange={(e) => setExtraDate(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Room</label>
              <input
                type="text"
                required
                value={extraRoom}
                onChange={(e) => setExtraRoom(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Start Time</label>
              <input
                type="time"
                required
                value={extraStart}
                onChange={(e) => {
                  setExtraStart(e.target.value);
                  setExtraPeriod(`Extra Slot (${e.target.value} - ${extraEnd})`);
                }}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">End Time</label>
              <input
                type="time"
                required
                value={extraEnd}
                onChange={(e) => {
                  setExtraEnd(e.target.value);
                  setExtraPeriod(`Extra Slot (${extraStart} - ${e.target.value})`);
                }}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Topic</label>
              <input
                type="text"
                required
                value={extraTopic}
                onChange={(e) => setExtraTopic(e.target.value)}
                placeholder="Topic to be covered"
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={savingAttendance || extraConflicts.length > 0}
              className="rounded bg-[#165B33] px-4 py-2 text-sm font-medium text-white hover:bg-[#104526] disabled:opacity-50"
            >
              {savingAttendance ? 'Scheduling…' : 'Schedule Extra Class'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
