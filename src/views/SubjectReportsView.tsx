import React, { useEffect, useMemo, useState } from 'react';
import { StandingIndicator } from '../components/StatusIndicator.tsx';
import { computeSubjectAttendance } from '../shared/attendanceMath.ts';
import {
  AcademicSection,
  AttendanceAuditLog,
  AttendanceCorrectionRequest,
  AttendanceRecord,
  ClassSession,
  FacultyAssignment,
  InstitutionalPolicy,
  SubjectAttendanceComputed,
  SubjectItem,
  TimetableEntry,
  UserProfile,
} from '../shared/types.ts';

interface SubjectReportsViewProps {
  user: UserProfile;
  policy: InstitutionalPolicy;
  sections: AcademicSection[];
  facultyAssignments: FacultyAssignment[];
  subjects: SubjectItem[];
  subjectMetrics: SubjectAttendanceComputed[];
  classes: ClassSession[];
  records: AttendanceRecord[];
  corrections: AttendanceCorrectionRequest[];
  auditLogs: AttendanceAuditLog[];
  timetable: TimetableEntry[];
  cohortUsers: UserProfile[];
  initialSubjectId?: string | null;
  onStartCorrectionForRecord: (recordId: string) => void;
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export const SubjectReportsView: React.FC<SubjectReportsViewProps> = ({
  user,
  policy,
  sections,
  facultyAssignments,
  subjects,
  subjectMetrics,
  classes,
  records,
  timetable,
  cohortUsers,
  initialSubjectId,
  onStartCorrectionForRecord,
}) => {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    () => initialSubjectId || subjectMetrics[0]?.subject.id || subjects[0]?.id || ''
  );
  const [historyFilter, setHistoryFilter] = useState<'all' | 'present' | 'absent'>('all');

  useEffect(() => {
    if (initialSubjectId) {
      setSelectedSubjectId(initialSubjectId);
    }
  }, [initialSubjectId]);

  const selectedStudentMetric = useMemo(() => {
    if (user.role !== 'student') return null;
    return (
      subjectMetrics.find((m) => m.subject.id === selectedSubjectId) ||
      subjectMetrics[0] ||
      null
    );
  }, [user.role, subjectMetrics, selectedSubjectId]);

  const studentHistoryRows = useMemo(() => {
    if (user.role !== 'student' || !selectedStudentMetric) return [];
    const sessionMap = new Map<string, ClassSession>(classes.map((c) => [c.id, c]));
    const rows = records
      .filter((r) => r.subjectId === selectedStudentMetric.subject.id)
      .map((rec) => {
        const session = sessionMap.get(rec.classId);
        if (!session) return null;
        if (
          session.status === 'Scheduled' ||
          session.status === 'Confirmed' ||
          session.status === 'Rescheduled' ||
          session.status === 'Cancelled'
        ) {
          return null;
        }
        const isPresent =
          rec.status === 'Present' ||
          (rec.status === 'Corrected' && rec.effectivePresent) ||
          (rec.status === 'Excused' && policy.excusedAbsencePolicy === 'count_as_attended');
        return {
          rec,
          session,
          isPresent,
        };
      })
      .filter(
        (item): item is { rec: AttendanceRecord; session: ClassSession; isPresent: boolean } =>
          Boolean(item)
      )
      .sort((a, b) =>
        `${b.session.date}T${b.session.startTime}`.localeCompare(
          `${a.session.date}T${a.session.startTime}`
        )
      );

    if (historyFilter === 'present') {
      return rows.filter((r) => r.isPresent);
    }
    if (historyFilter === 'absent') {
      return rows.filter((r) => !r.isPresent);
    }
    return rows;
  }, [user.role, selectedStudentMetric, classes, records, policy.excusedAbsencePolicy, historyFilter]);

  const availableAssignments = useMemo(() => {
    const active = facultyAssignments.filter((fa) => fa.status === 'Active');
    if (user.role === 'faculty') {
      return active.filter((fa) => fa.facultyId === user.id);
    }
    return active;
  }, [facultyAssignments, user]);

  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>(() => {
    if (initialSubjectId) {
      const match = availableAssignments.find((a) => a.subjectId === initialSubjectId);
      if (match) return match.id;
    }
    return availableAssignments[0]?.id || '';
  });

  useEffect(() => {
    if (initialSubjectId && user.role !== 'student') {
      const match = availableAssignments.find((a) => a.subjectId === initialSubjectId);
      if (match) setSelectedAssignmentId(match.id);
    }
  }, [initialSubjectId, availableAssignments, user.role]);

  const activeAssignment = useMemo(
    () =>
      availableAssignments.find((a) => a.id === selectedAssignmentId) ||
      availableAssignments[0] ||
      null,
    [availableAssignments, selectedAssignmentId]
  );

  const cohortRows = useMemo(() => {
    if (user.role === 'student' || !activeAssignment) return [];
    const subj = subjects.find((s) => s.id === activeAssignment.subjectId);
    if (!subj) return [];
    const secStudents = cohortUsers
      .filter(
        (u) =>
          u.role === 'student' &&
          u.sectionId === activeAssignment.sectionId &&
          u.accountStatus === 'Active'
      )
      .sort((a, b) => a.identifier.localeCompare(b.identifier));

    return secStudents.map((stu) => {
      const stuRecords = records.filter((r) => r.studentId === stu.id);
      const computed = computeSubjectAttendance(
        subj,
        classes,
        stuRecords,
        timetable,
        policy,
        activeAssignment.sectionId
      );
      return {
        student: stu,
        computed,
      };
    });
  }, [user.role, activeAssignment, subjects, cohortUsers, records, classes, timetable, policy]);

  if (user.role === 'student') {
    if (!selectedStudentMetric) {
      return (
        <div className="rounded-md border border-[#E3D2B4] bg-white p-6 text-sm text-[#6B5A4C]">
          No courses found for this semester.
        </div>
      );
    }

    const subj = selectedStudentMetric.subject;
    const assignedTeacher =
      facultyAssignments.find(
        (fa) =>
          fa.subjectId === subj.id &&
          fa.sectionId === user.sectionId &&
          fa.status === 'Active'
      )?.facultyName || subj.assignedFacultyName;

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[#E3D2B4] pb-5">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-[#165B33]">{subj.name}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#6B5A4C]">
              <span className="font-mono">{subj.code}</span>
              <span>·</span>
              <span>{assignedTeacher}</span>
              <span>·</span>
              <span>Semester {subj.semester}</span>
            </div>
          </div>

          <div className="self-start">
            <select
              aria-label="Select course"
              value={subj.id}
              onChange={(e) => {
                setSelectedSubjectId(e.target.value);
                setHistoryFilter('all');
              }}
              className="rounded border border-[#E3D2B4] bg-white px-3 py-1.5 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
            >
              {subjectMetrics.map((m) => (
                <option key={m.subject.id} value={m.subject.id}>
                  {m.subject.code} — {m.subject.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <section className="rounded-md border border-[#E3D2B4] bg-white divide-y sm:divide-y-0 sm:divide-x divide-[#E3D2B4] grid grid-cols-2 sm:grid-cols-4">
          <div className="px-5 py-4">
            <div className="text-xs font-medium text-[#6B5A4C]">Classes Attended</div>
            <div className="mt-1 text-xl font-semibold text-[#241710] tabular-nums">
              {selectedStudentMetric.attended} / {selectedStudentMetric.conducted}
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="text-xs font-medium text-[#6B5A4C]">Attendance</div>
            <div className="mt-1 text-xl font-semibold text-[#165B33] tabular-nums">
              {selectedStudentMetric.percentage !== null
                ? `${Math.round(selectedStudentMetric.percentage)}%`
                : '—'}
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="text-xs font-medium text-[#6B5A4C]">Minimum Required</div>
            <div className="mt-1 text-xl font-semibold text-[#241710] tabular-nums">
              {selectedStudentMetric.requiredPercentage}%
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="text-xs font-medium text-[#6B5A4C]">Status</div>
            <div className="mt-1.5">
              <StandingIndicator standing={selectedStudentMetric.standing} />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[#165B33]">Session Register</h2>

            <div className="inline-flex rounded border border-[#E3D2B4] bg-[#FFFDF8] p-1 self-start">
              {(
                [
                  { id: 'all', label: 'All Sessions' },
                  { id: 'present', label: 'Present' },
                  { id: 'absent', label: 'Absent' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setHistoryFilter(tab.id)}
                  className={`rounded px-3 py-1 text-xs font-medium whitespace-nowrap ${
                    historyFilter === tab.id
                      ? 'bg-[#DF6A24] text-white'
                      : 'text-[#6B5A4C] hover:text-[#241710]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                  <th className="py-3 px-4 w-28">Date</th>
                  <th className="py-3 px-4 w-36">Time</th>
                  <th className="py-3 px-4">Topic</th>
                  <th className="py-3 px-4 w-52">Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3D2B4] text-sm">
                {studentHistoryRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-[#6B5A4C]">
                      No sessions match this filter.
                    </td>
                  </tr>
                ) : (
                  studentHistoryRows.map(({ rec, session, isPresent }) => (
                    <tr key={rec.id} className="hover:bg-[#FAF3E3]/55">
                      <td className="py-3.5 px-4 tabular-nums text-[#241710] whitespace-nowrap">
                        {formatShortDate(session.date)}
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-[#6B5A4C] whitespace-nowrap">
                        {session.startTime} – {session.endTime}
                      </td>
                      <td className="py-3.5 px-4 text-[#241710]">{session.topic}</td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center justify-between gap-3">
                          {rec.status === 'Excused' ? (
                            <span className="font-medium text-[#DF6A24]">Excused</span>
                          ) : isPresent ? (
                            <span className="font-medium text-[#165B33]">Present</span>
                          ) : (
                            <span className="font-medium text-[#B42318]">Absent</span>
                          )}

                          {rec.status === 'Absent' && !rec.pendingRequestId && (
                            <button
                              type="button"
                              onClick={() => onStartCorrectionForRecord(rec.id)}
                              className="text-xs font-medium text-[#DF6A24] hover:underline"
                            >
                              Upload Evidence
                            </button>
                          )}
                          {rec.pendingRequestId && (
                            <span className="text-xs text-[#B45309]">Evidence submitted</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  const sectionObj = sections.find((s) => s.id === activeAssignment?.sectionId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[#E3D2B4] pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#165B33]">Class Attendance Report</h1>
          {activeAssignment && (
            <p className="mt-1 text-sm text-[#6B5A4C]">
              {activeAssignment.sectionDisplayName} · {activeAssignment.subjectCode}{' '}
              {activeAssignment.subjectName} · Semester {sectionObj?.semester || policy.semester}
            </p>
          )}
        </div>

        <select
          aria-label="Select section and course"
          value={activeAssignment?.id || ''}
          onChange={(e) => setSelectedAssignmentId(e.target.value)}
          className="rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710] self-start"
        >
          {availableAssignments.map((fa) => (
            <option key={fa.id} value={fa.id}>
              {fa.sectionDisplayName} — {fa.subjectCode} {fa.subjectName}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
              <th className="py-3 px-4 w-44">USN</th>
              <th className="py-3 px-4">Student Name</th>
              <th className="py-3 px-4">Attended</th>
              <th className="py-3 px-4">Attendance</th>
              <th className="py-3 px-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3D2B4] text-sm">
            {cohortRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 px-4 text-center text-[#6B5A4C]">
                  No students enrolled in this section.
                </td>
              </tr>
            ) : (
              cohortRows.map(({ student, computed }) => (
                <tr key={student.id} className="hover:bg-[#FAF3E3]/55">
                  <td className="py-3.5 px-4 font-mono text-xs text-[#241710]">
                    {student.identifier}
                  </td>
                  <td className="py-3.5 px-4 font-medium text-[#241710]">{student.name}</td>
                  <td className="py-3.5 px-4 tabular-nums text-[#241710]">
                    {computed.attended} / {computed.conducted}
                  </td>
                  <td className="py-3.5 px-4 tabular-nums font-medium text-[#241710]">
                    {computed.percentage !== null ? `${Math.round(computed.percentage)}%` : '—'}
                  </td>
                  <td className="py-3.5 px-4">
                    <StandingIndicator standing={computed.standing} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
