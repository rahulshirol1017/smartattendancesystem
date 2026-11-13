import React, { useMemo } from 'react';
import { StandingIndicator } from '../components/StatusIndicator.tsx';
import { computeSubjectAttendance } from '../shared/attendanceMath.ts';
import {
  AcademicSection,
  AttendanceCorrectionRequest,
  AttendanceRecord,
  ClassSession,
  FacultyAssignment,
  InstitutionalPolicy,
  NavigationSection,
  OverallAttendanceSummary,
  SubjectAttendanceComputed,
  SubjectItem,
  TimetableEntry,
  UserProfile,
  QRAttendanceSession,
} from '../shared/types.ts';
import { Camera } from 'lucide-react';

interface DashboardViewProps {
  user: UserProfile;
  policy: InstitutionalPolicy;
  sections: AcademicSection[];
  facultyAssignments: FacultyAssignment[];
  subjectMetrics: SubjectAttendanceComputed[];
  overallSummary: OverallAttendanceSummary;
  subjects: SubjectItem[];
  classes: ClassSession[];
  records: AttendanceRecord[];
  corrections: AttendanceCorrectionRequest[];
  timetable: TimetableEntry[];
  cohortUsers: UserProfile[];
  activeQrSessions?: QRAttendanceSession[];
  onOpenScanModal?: () => void;
  onOpenSubjectReport: (subjectId: string) => void;
  onOpenSessionForAttendance: (sessionId: string) => void;
  onNavigate: (section: NavigationSection) => void;
}

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getFirstName(fullName: string): string {
  const cleaned = fullName.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+/i, '').trim();
  return cleaned.split(/\s+/)[0] || fullName;
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  user,
  policy,
  sections,
  facultyAssignments,
  subjectMetrics,
  overallSummary,
  subjects,
  classes,
  records,
  corrections,
  timetable,
  cohortUsers,
  activeQrSessions = [],
  onOpenScanModal,
  onOpenSubjectReport,
  onOpenSessionForAttendance,
  onNavigate,
}) => {
  const greeting = getTimeGreeting();
  const activeClassSession = activeQrSessions.find(
    (s) => s.status === 'ACTIVE' && (!user.sectionId || s.sectionId === user.sectionId)
  );

  const studentUpcomingClasses = useMemo(() => {
    if (user.role !== 'student') return [];
    const subjectMap = new Map<string, SubjectItem>(subjects.map((s) => [s.id, s]));

    const scheduledSessions = classes
      .filter(
        (c) =>
          (!user.sectionId || c.sectionId === user.sectionId) &&
          (c.status === 'Scheduled' || c.status === 'Confirmed') &&
          c.approvalStatus === 'Approved'
      )
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));

    const items: Array<{
      id: string;
      time: string;
      dateLabel: string;
      subjectCode: string;
      subjectName: string;
      facultyName: string;
      classroom: string;
      note?: string;
    }> = scheduledSessions.map((c) => {
      const subj = subjectMap.get(c.subjectId);
      return {
        id: c.id,
        time: `${c.startTime} – ${c.endTime}`,
        dateLabel: formatShortDate(c.date),
        subjectCode: c.subjectCode || subj?.code || '',
        subjectName: c.subjectName || subj?.name || 'Class',
        facultyName: c.facultyName,
        classroom: c.classroom,
        note: c.sessionType !== 'Regular' ? `${c.sessionType} class` : undefined,
      };
    });

    if (items.length < 3) {
      const seenKeys = new Set(items.map((i) => `${i.subjectName}-${i.time}`));
      const activeSlots = timetable
        .filter(
          (t) =>
            t.status === 'Active' &&
            (!user.sectionId || t.sectionId === user.sectionId) &&
            t.upcomingStatus !== 'Cancelled' &&
            t.upcomingStatus !== 'Rescheduled'
        )
        .sort((a, b) =>
          `${a.upcomingDate}T${a.startTime}`.localeCompare(`${b.upcomingDate}T${b.startTime}`)
        );

      for (const slot of activeSlots) {
        if (items.length >= 3) break;
        const key = `${slot.subjectName}-${slot.startTime} – ${slot.endTime}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        items.push({
          id: slot.id,
          time: `${slot.startTime} – ${slot.endTime}`,
          dateLabel: slot.dayOfWeek.slice(0, 3),
          subjectCode: slot.subjectCode,
          subjectName: slot.subjectName,
          facultyName: slot.facultyName,
          classroom: slot.classroom,
        });
      }
    }

    return items.slice(0, 3);
  }, [user, subjects, classes, timetable]);

  const sortedFacultyClasses = useMemo(() => {
    if (user.role !== 'faculty') return [];
    const subjectMap = new Map<string, SubjectItem>(subjects.map((s) => [s.id, s]));
    const pending = classes
      .filter(
        (s) =>
          (s.facultyId === user.id || s.scheduledFacultyId === user.id) &&
          (s.status === 'Scheduled' || s.status === 'Confirmed') &&
          s.approvalStatus === 'Approved'
      )
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));

    const recentConducted = classes
      .filter(
        (s) =>
          (s.facultyId === user.id || s.scheduledFacultyId === user.id) &&
          s.status === 'Conducted'
      )
      .sort((a, b) => `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`))
      .slice(0, 4);

    const combined = [...pending, ...recentConducted].slice(0, 6);
    return combined.map((s) => ({
      ...s,
      resolvedSubjectName: s.subjectName || subjectMap.get(s.subjectId)?.name || 'Course',
      resolvedSubjectCode: s.subjectCode || subjectMap.get(s.subjectId)?.code || '',
    }));
  }, [user, subjects, classes]);

  const adminSectionRows = useMemo(() => {
    if (user.role !== 'admin') return [];
    const activeSections = sections.filter((s) => s.status === 'Active');
    return activeSections.map((sec) => {
      const secStudents = cohortUsers.filter(
        (u) => u.role === 'student' && u.sectionId === sec.id && u.accountStatus === 'Active'
      );
      const secSubjectIds = Array.from(
        new Set(
          facultyAssignments
            .filter((fa) => fa.sectionId === sec.id && fa.status === 'Active')
            .map((fa) => fa.subjectId)
        )
      );
      const secSubjects = subjects.filter((s) => secSubjectIds.includes(s.id));
      const conductedSessions = classes.filter(
        (c) => c.sectionId === sec.id && c.status === 'Conducted'
      ).length;

      let sumPct = 0;
      let countPct = 0;
      let studentsBelowReq = 0;

      for (const stu of secStudents) {
        const stuRecords = records.filter((r) => r.studentId === stu.id);
        const metrics = secSubjects.map((subj) =>
          computeSubjectAttendance(subj, classes, stuRecords, timetable, policy, sec.id)
        );
        const conducted = metrics.reduce((acc, m) => acc + m.conducted, 0);
        const attended = metrics.reduce((acc, m) => acc + m.attended, 0);
        if (conducted > 0) {
          const pct = (attended / conducted) * 100;
          sumPct += pct;
          countPct += 1;
        }
        if (metrics.some((m) => m.standing === 'At Risk')) {
          studentsBelowReq += 1;
        }
      }

      return {
        section: sec,
        studentCount: secStudents.length,
        conductedSessions,
        averageAttendance: countPct > 0 ? Math.round((sumPct / countPct) * 10) / 10 : null,
        studentsBelowReq,
      };
    });
  }, [user.role, sections, cohortUsers, facultyAssignments, subjects, classes, records, timetable, policy]);

  const openCorrectionsCount = useMemo(
    () =>
      corrections.filter(
        (c) =>
          c.workflowStatus === 'Submitted' ||
          c.workflowStatus === 'Under Review' ||
          c.workflowStatus === 'Additional Evidence Requested'
      ).length,
    [corrections]
  );

  // ============================================================================
  // 1. STUDENT DASHBOARD
  // ============================================================================
  if (user.role === 'student') {
    const firstName = getFirstName(user.name);
    const overallPctDisplay =
      overallSummary.overallPercentage !== null
        ? `${Math.round(overallSummary.overallPercentage)}%`
        : '—';

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-[#165B33]">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-[#6B5A4C]">
            {user.sectionDisplayName || `CSBS ${user.section}`} · Semester {user.semester}
          </p>
        </div>

        {/* Prominent Scan Attendance Banner */}
        <div className="rounded-md border-2 border-[#165B33] bg-[#FAF3E3] p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#165B33] flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#165B33]">
                {activeClassSession
                  ? `Active Class Session: ${activeClassSession.subjectName}`
                  : 'Time & Location Verified Attendance'}
              </div>
              <div className="text-xs text-[#241710]/80">
                {activeClassSession
                  ? `Dynamic QR code is live for ${activeClassSession.sectionDisplayName} (${activeClassSession.classroom}). Tap to scan!`
                  : 'Scan the dynamic classroom QR code using your device within the campus perimeter.'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenScanModal}
            className="w-full sm:w-auto shrink-0 bg-[#DF6A24] hover:bg-[#c95b1b] text-white px-5 py-2.5 rounded-md text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-2"
          >
            <Camera className="w-4 h-4" />
            <span>Scan Attendance</span>
          </button>
        </div>

        <section
          aria-label="Attendance summary"
          className="rounded-md border border-[#E3D2B4] bg-white divide-y sm:divide-y-0 sm:divide-x divide-[#E3D2B4] grid grid-cols-1 sm:grid-cols-3"
        >
          <div className="px-5 py-4">
            <div className="text-xs font-medium text-[#6B5A4C]">Overall Attendance</div>
            <div className="mt-1 text-2xl font-semibold text-[#165B33] tabular-nums">
              {overallPctDisplay}
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="text-xs font-medium text-[#6B5A4C]">Classes Attended</div>
            <div className="mt-1 text-2xl font-semibold text-[#241710] tabular-nums">
              {overallSummary.totalAttended} / {overallSummary.totalConducted}
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="text-xs font-medium text-[#6B5A4C]">
              Courses Below {policy.defaultMinimumPercentage}%
            </div>
            <div
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                overallSummary.subjectsBelowThreshold > 0 ? 'text-[#B42318]' : 'text-[#165B33]'
              }`}
            >
              {overallSummary.subjectsBelowThreshold}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-base font-semibold text-[#165B33]">Course Attendance</h2>
            <span className="text-xs text-[#6B5A4C]">{user.identifier}</span>
          </div>

          <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                  <th className="py-3 px-4">Course</th>
                  <th className="py-3 px-4">Attended</th>
                  <th className="py-3 px-4">Attendance</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3D2B4] text-sm">
                {subjectMetrics.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-sm text-[#6B5A4C]">
                      No courses assigned to your section.
                    </td>
                  </tr>
                ) : (
                  subjectMetrics.map((m) => {
                    const pctValue = m.percentage !== null ? Math.round(m.percentage) : null;
                    const barColor =
                      m.standing === 'At Risk'
                        ? 'bg-[#B42318]'
                        : m.standing === 'Needs Attention'
                        ? 'bg-[#DF6A24]'
                        : 'bg-[#165B33]';

                    return (
                      <tr
                        key={m.subject.id}
                        onClick={() => onOpenSubjectReport(m.subject.id)}
                        className="cursor-pointer hover:bg-[#FAF3E3]/55 transition-colors"
                      >
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-[#241710]">{m.subject.name}</div>
                          <div className="text-xs text-[#6B5A4C] font-mono mt-0.5">
                            {m.subject.code}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 tabular-nums text-[#241710] whitespace-nowrap">
                          {m.attended}/{m.conducted}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-[#241710] tabular-nums w-10">
                              {pctValue !== null ? `${pctValue}%` : '—'}
                            </span>
                            {pctValue !== null && (
                              <div className="hidden sm:block w-20 h-1.5 rounded-sm bg-[#E3D2B4]/60 overflow-hidden">
                                <div
                                  className={`h-full ${barColor}`}
                                  style={{ width: `${Math.min(100, Math.max(0, pctValue))}%` }}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <StandingIndicator standing={m.standing} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-base font-semibold text-[#165B33]">Upcoming Classes</h2>
            <button
              type="button"
              onClick={() => onNavigate('timetable')}
              className="text-xs font-medium text-[#DF6A24] hover:underline"
            >
              View full timetable
            </button>
          </div>

          <div className="rounded-md border border-[#E3D2B4] bg-white divide-y divide-[#E3D2B4]">
            {studentUpcomingClasses.length === 0 ? (
              <div className="p-5 text-sm text-[#6B5A4C]">No upcoming classes scheduled.</div>
            ) : (
              studentUpcomingClasses.map((cls) => (
                <div
                  key={cls.id}
                  className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-[#241710]">
                      {cls.subjectCode ? `${cls.subjectCode} · ` : ''}
                      {cls.subjectName}
                      {cls.note && (
                        <span className="ml-2 text-xs font-normal text-[#DF6A24]">
                          ({cls.note})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#6B5A4C]">{cls.facultyName}</div>
                  </div>

                  <div className="flex items-center gap-4 text-xs sm:text-sm text-[#241710] tabular-nums">
                    <span className="text-[#6B5A4C]">{cls.dateLabel}</span>
                    <span className="font-medium">{cls.time}</span>
                    <span className="text-[#6B5A4C]">{cls.classroom}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    );
  }

  // ============================================================================
  // 2. FACULTY DASHBOARD
  // ============================================================================
  if (user.role === 'faculty') {
    const myAssignments = facultyAssignments.filter(
      (fa) => fa.facultyId === user.id && fa.status === 'Active'
    );

    return (
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[#165B33]">
              {greeting}, {user.name}
            </h1>
            <p className="mt-1 text-sm text-[#6B5A4C]">
              {user.department} · {policy.academicYear} (Semester {policy.semester})
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('qr-attendance')}
              className="rounded bg-[#165B33] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#124b2a] shadow-sm flex items-center gap-1.5 transition-colors"
            >
              <Camera className="w-4 h-4" />
              <span>Launch QR Attendance</span>
            </button>
            {openCorrectionsCount > 0 && (
              <button
                type="button"
                onClick={() => onNavigate('corrections')}
                className="rounded border border-[#DF6A24] bg-[#FFFDF8] px-3.5 py-2 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3]"
              >
                {openCorrectionsCount} evidence{' '}
                {openCorrectionsCount === 1 ? 'submission' : 'submissions'} pending
              </button>
            )}
          </div>
        </div>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-base font-semibold text-[#165B33]">Scheduled & Recent Classes</h2>
            <button
              type="button"
              onClick={() => onNavigate('timetable')}
              className="text-xs font-medium text-[#DF6A24] hover:underline"
            >
              Weekly timetable
            </button>
          </div>

          <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Course</th>
                  <th className="py-3 px-4">Section</th>
                  <th className="py-3 px-4">Room</th>
                  <th className="py-3 px-4 text-right">Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3D2B4] text-sm">
                {sortedFacultyClasses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 px-4 text-center text-sm text-[#6B5A4C]">
                      No classes scheduled.
                    </td>
                  </tr>
                ) : (
                  sortedFacultyClasses.map((cls) => (
                    <tr key={cls.id} className="hover:bg-[#FAF3E3]/55">
                      <td className="py-3.5 px-4 whitespace-nowrap tabular-nums">
                        <div className="font-medium text-[#241710]">
                          {cls.startTime} – {cls.endTime}
                        </div>
                        <div className="text-xs text-[#6B5A4C]">{formatShortDate(cls.date)}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-[#241710]">{cls.resolvedSubjectName}</div>
                        <div className="text-xs text-[#6B5A4C] font-mono">
                          {cls.resolvedSubjectCode}
                          {cls.sessionType !== 'Regular' ? ` · ${cls.sessionType}` : ''}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-medium text-[#241710] whitespace-nowrap">
                        {cls.sectionDisplayName}
                      </td>
                      <td className="py-3.5 px-4 text-[#6B5A4C] whitespace-nowrap">
                        {cls.classroom}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        {cls.attendanceSubmitted || cls.status === 'Conducted' ? (
                          <button
                            type="button"
                            onClick={() => onOpenSessionForAttendance(cls.id)}
                            className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3 py-1.5 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3]"
                          >
                            Edit Register
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onOpenSessionForAttendance(cls.id)}
                            className="rounded bg-[#165B33] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#104526]"
                          >
                            Mark Attendance
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-[#165B33]">Assigned Courses</h2>
          <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                  <th className="py-3 px-4">Section</th>
                  <th className="py-3 px-4">Course</th>
                  <th className="py-3 px-4">Weekly Slots</th>
                  <th className="py-3 px-4">Classes Recorded</th>
                  <th className="py-3 px-4 text-right">Register</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3D2B4] text-sm">
                {myAssignments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 px-4 text-center text-[#6B5A4C]">
                      No courses assigned.
                    </td>
                  </tr>
                ) : (
                  myAssignments.map((fa) => {
                    const weeklyCount = timetable.filter(
                      (t) => t.facultyAssignmentId === fa.id && t.status === 'Active'
                    ).length;
                    const conductedCount = classes.filter(
                      (c) =>
                        c.sectionId === fa.sectionId &&
                        c.subjectId === fa.subjectId &&
                        c.status === 'Conducted'
                    ).length;
                    return (
                      <tr key={fa.id} className="hover:bg-[#FAF3E3]/55">
                        <td className="py-3 px-4 font-medium text-[#241710]">
                          {fa.sectionDisplayName}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-[#241710]">{fa.subjectName}</div>
                          <div className="text-xs text-[#6B5A4C] font-mono">{fa.subjectCode}</div>
                        </td>
                        <td className="py-3 px-4 tabular-nums text-[#241710]">{weeklyCount}</td>
                        <td className="py-3 px-4 tabular-nums text-[#241710]">{conductedCount}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => onOpenSubjectReport(fa.subjectId)}
                            className="text-xs font-medium text-[#DF6A24] hover:underline"
                          >
                            View report
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  // ============================================================================
  // 3. ADMINISTRATOR DASHBOARD
  // ============================================================================
  const totalStudents = cohortUsers.filter(
    (u) => u.role === 'student' && u.accountStatus === 'Active'
  ).length;
  const totalFaculty = cohortUsers.filter(
    (u) => u.role === 'faculty' && u.accountStatus === 'Active'
  ).length;
  const activeSectionsCount = sections.filter((s) => s.status === 'Active').length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#165B33]">CSBS Academic Overview</h1>
          <p className="mt-1 text-sm text-[#6B5A4C]">
            {policy.institutionName} · {policy.academicYear} (Semester {policy.semester})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('admin-students')}
            className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3.5 py-2 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3]"
          >
            Manage Students
          </button>
          <button
            type="button"
            onClick={() => onNavigate('admin-timetable')}
            className="rounded bg-[#165B33] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#104526]"
          >
            Manage Timetable
          </button>
        </div>
      </div>

      <section className="rounded-md border border-[#E3D2B4] bg-white divide-y sm:divide-y-0 sm:divide-x divide-[#E3D2B4] grid grid-cols-2 sm:grid-cols-4">
        <div className="px-5 py-4">
          <div className="text-xs font-medium text-[#6B5A4C]">Active Sections</div>
          <div className="mt-1 text-2xl font-semibold text-[#165B33] tabular-nums">
            {activeSectionsCount}
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs font-medium text-[#6B5A4C]">Enrolled Students</div>
          <div className="mt-1 text-2xl font-semibold text-[#241710] tabular-nums">
            {totalStudents}
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs font-medium text-[#6B5A4C]">CSBS Faculty</div>
          <div className="mt-1 text-2xl font-semibold text-[#241710] tabular-nums">
            {totalFaculty}
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs font-medium text-[#6B5A4C]">Evidence Pending</div>
          <div
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              openCorrectionsCount > 0 ? 'text-[#B45309]' : 'text-[#241710]'
            }`}
          >
            {openCorrectionsCount}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-base font-semibold text-[#165B33]">Section Attendance Summary</h2>
          <button
            type="button"
            onClick={() => onNavigate('admin-sections')}
            className="text-xs font-medium text-[#DF6A24] hover:underline"
          >
            Manage sections
          </button>
        </div>

        <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                <th className="py-3 px-4">Section</th>
                <th className="py-3 px-4">Room</th>
                <th className="py-3 px-4">Students</th>
                <th className="py-3 px-4">Classes Held</th>
                <th className="py-3 px-4">Average Attendance</th>
                <th className="py-3 px-4">Below {policy.defaultMinimumPercentage}%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3D2B4] text-sm">
              {adminSectionRows.map((row) => (
                <tr key={row.section.id} className="hover:bg-[#FAF3E3]/55">
                  <td className="py-3.5 px-4 font-medium text-[#241710]">
                    {row.section.displayName}
                    <span className="ml-2 text-xs font-normal text-[#6B5A4C]">
                      Sem {row.section.semester}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-[#6B5A4C]">{row.section.defaultClassroom}</td>
                  <td className="py-3.5 px-4 tabular-nums text-[#241710]">{row.studentCount}</td>
                  <td className="py-3.5 px-4 tabular-nums text-[#241710]">
                    {row.conductedSessions}
                  </td>
                  <td className="py-3.5 px-4 tabular-nums font-medium text-[#241710]">
                    {row.averageAttendance !== null ? `${row.averageAttendance.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-3.5 px-4 tabular-nums">
                    {row.studentsBelowReq > 0 ? (
                      <span className="font-medium text-[#B42318]">
                        {row.studentsBelowReq}{' '}
                        {row.studentsBelowReq === 1 ? 'student' : 'students'}
                      </span>
                    ) : (
                      <span className="text-[#165B33]">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
