import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api, ApiRequestError } from '../api/client.ts';
import { RecordStatusIndicator, StandingIndicator } from '../components/StatusIndicator.tsx';
import { validateSessionConflicts } from '../shared/conflictCheck.ts';
import {
  AcademicSection,
  AttendanceAuditLog,
  AttendanceCorrectionRequest,
  AttendanceRecord,
  ClassSession,
  ClassSessionType,
  ConflictDetail,
  FacultyAssignment,
  InstitutionalPolicy,
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

  useEffect(() => {
    if (!currentSession) return;
    setTopicDraft(currentSession.topic || '');
    const existingForSession = new Map<string, AttendanceRecord>();
    for (const r of records) {
      if (r.classId === currentSession.id) {
        existingForSession.set(r.studentId, r);
      }
    }
    const nextRoll: Record<string, 'Present' | 'Absent' | 'Excused'> = {};
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
    setRollDraft(nextRoll);
  }, [currentSession, records, sectionStudents]);

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
  const handleMarkAllPresent = () => {
    const updated: Record<string, 'Present' | 'Absent' | 'Excused'> = {};
    for (const stu of sectionStudents) {
      updated[stu.id] = 'Present';
    }
    setRollDraft(updated);
  };

  const handleMarkAllAbsent = () => {
    const updated: Record<string, 'Present' | 'Absent' | 'Excused'> = {};
    for (const stu of sectionStudents) {
      updated[stu.id] = 'Absent';
    }
    setRollDraft(updated);
  };

  const handleSaveScheduledAttendance = async () => {
    if (!currentSession) return;
    setSavingAttendance(true);
    setFeedback(null);
    try {
      const payload = sectionStudents.map((stu) => ({
        studentId: stu.id,
        status: rollDraft[stu.id] || 'Present',
      }));
      await api.submitSessionAttendance(currentSession.id, {
        topic: topicDraft.trim() || currentSession.topic,
        attendance: payload,
      });
      await onRefreshWorkspace();
      setFeedback({ type: 'success', text: 'Attendance saved.' });
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
          <div className="rounded-md border border-[#E3D2B4] bg-white p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Class Session
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
                      {s.attendanceSubmitted ? 'Submitted' : 'Open'})
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

                <div className="text-xs text-[#6B5A4C] tabular-nums">
                  Present: <strong className="text-[#165B33]">{presentCount}</strong> · Absent:{' '}
                  <strong className="text-[#B42318]">{absentCount}</strong>
                </div>
              </div>
            )}
          </div>

          {currentSession ? (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
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
                    onClick={handleMarkAllPresent}
                    className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3 py-2 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3] whitespace-nowrap"
                  >
                    Mark All Present
                  </button>
                  <button
                    type="button"
                    onClick={handleMarkAllAbsent}
                    className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3 py-2 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3] whitespace-nowrap"
                  >
                    Mark All Absent
                  </button>
                  <button
                    type="button"
                    disabled={savingAttendance || sectionStudents.length === 0}
                    onClick={handleSaveScheduledAttendance}
                    className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526] disabled:opacity-50 whitespace-nowrap"
                  >
                    {savingAttendance ? 'Saving…' : 'Save Attendance'}
                  </button>
                </div>
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
                    {visibleStudents.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-8 px-4 text-center text-[#6B5A4C]">
                          No students match your search.
                        </td>
                      </tr>
                    ) : (
                      visibleStudents.map((stu) => {
                        const status = rollDraft[stu.id] || 'Present';
                        return (
                          <tr key={stu.id} className="hover:bg-[#FAF3E3]/55">
                            <td className="py-3 px-4 font-mono text-xs text-[#241710] whitespace-nowrap">
                              {stu.identifier}
                            </td>
                            <td className="py-3 px-4 font-medium text-[#241710]">{stu.name}</td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex rounded border border-[#E3D2B4] bg-[#FAF3E3] p-0.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRollDraft((prev) => ({ ...prev, [stu.id]: 'Present' }))
                                  }
                                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                                    status === 'Present'
                                      ? 'bg-[#165B33] text-white'
                                      : 'text-[#6B5A4C] hover:text-[#241710]'
                                  }`}
                                >
                                  Present
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRollDraft((prev) => ({ ...prev, [stu.id]: 'Absent' }))
                                  }
                                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                                    status === 'Absent'
                                      ? 'bg-[#B42318] text-white'
                                      : 'text-[#6B5A4C] hover:text-[#241710]'
                                  }`}
                                >
                                  Absent
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRollDraft((prev) => ({ ...prev, [stu.id]: 'Excused' }))
                                  }
                                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                                    status === 'Excused'
                                      ? 'bg-[#DF6A24] text-white'
                                      : 'text-[#6B5A4C] hover:text-[#241710]'
                                  }`}
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
