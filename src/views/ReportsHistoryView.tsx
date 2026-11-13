import React, { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
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
  SubjectItem,
  TimetableEntry,
  UserProfile,
} from '../shared/types.ts';

interface ReportsHistoryViewProps {
  user: UserProfile;
  policy: InstitutionalPolicy;
  sections: AcademicSection[];
  facultyAssignments: FacultyAssignment[];
  subjects: SubjectItem[];
  classes: ClassSession[];
  records: AttendanceRecord[];
  corrections: AttendanceCorrectionRequest[];
  auditLogs: AttendanceAuditLog[];
  timetable: TimetableEntry[];
  cohortUsers: UserProfile[];
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const ReportsHistoryView: React.FC<ReportsHistoryViewProps> = ({
  user,
  policy,
  sections,
  facultyAssignments,
  subjects,
  classes,
  records,
  auditLogs,
  timetable,
  cohortUsers,
}) => {
  const activeSections = useMemo(
    () => sections.filter((s) => s.status === 'Active'),
    [sections]
  );

  const [selectedSectionId, setSelectedSectionId] = useState<string>(
    () => user.sectionId || activeSections[0]?.id || ''
  );

  const studentReportRows = useMemo(() => {
    if (user.role !== 'student') return [];
    return subjects.map((subj) =>
      computeSubjectAttendance(subj, classes, records, timetable, policy, user.sectionId)
    );
  }, [user, subjects, classes, records, timetable, policy]);

  const sectionSummaryRows = useMemo(() => {
    if (user.role === 'student') return [];
    const secStudents = cohortUsers
      .filter(
        (u) =>
          u.role === 'student' &&
          (!selectedSectionId || u.sectionId === selectedSectionId) &&
          u.accountStatus === 'Active'
      )
      .sort((a, b) => a.identifier.localeCompare(b.identifier));

    const secSubjectIds = Array.from(
      new Set(
        facultyAssignments
          .filter(
            (fa) =>
              (!selectedSectionId || fa.sectionId === selectedSectionId) &&
              fa.status === 'Active'
          )
          .map((fa) => fa.subjectId)
      )
    );
    const secSubjects =
      secSubjectIds.length > 0
        ? subjects.filter((s) => secSubjectIds.includes(s.id))
        : subjects;

    return secStudents.map((stu) => {
      const stuRecords = records.filter((r) => r.studentId === stu.id);
      const metrics = secSubjects.map((subj) =>
        computeSubjectAttendance(subj, classes, stuRecords, timetable, policy, stu.sectionId)
      );
      const attended = metrics.reduce((acc, m) => acc + m.attended, 0);
      const conducted = metrics.reduce((acc, m) => acc + m.conducted, 0);
      const pct = conducted > 0 ? Math.round((attended / conducted) * 1000) / 10 : null;
      const belowCount = metrics.filter((m) => m.standing === 'At Risk').length;
      return {
        student: stu,
        attended,
        conducted,
        percentage: pct,
        belowCount,
      };
    });
  }, [
    user.role,
    cohortUsers,
    selectedSectionId,
    facultyAssignments,
    subjects,
    records,
    classes,
    timetable,
    policy,
  ]);

  const handleDownloadCsv = () => {
    let csv = '';
    if (user.role === 'student') {
      csv = 'Course Code,Course Name,Attended,Conducted,Attendance %,Minimum Required %,Status\n';
      for (const m of studentReportRows) {
        csv += `"${m.subject.code}","${m.subject.name}",${m.attended},${m.conducted},${
          m.percentage ?? 0
        },${m.requiredPercentage},"${m.standing}"\n`;
      }
    } else {
      csv = 'USN,Student Name,Section,Attended,Conducted,Overall Attendance %,Courses Below Requirement\n';
      for (const r of sectionSummaryRows) {
        csv += `"${r.student.identifier}","${r.student.name}","${
          r.student.sectionDisplayName || r.student.section
        }",${r.attended},${r.conducted},${r.percentage ?? 0},${r.belowCount}\n`;
      }
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vtu-csbs-attendance-${policy.academicYear}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          {user.role !== 'admin' && (
            <>
              <h1 className="text-2xl font-semibold text-[#165B33]">Attendance Statement</h1>
              <p className="mt-1 text-sm text-[#6B5A4C]">
                {policy.institutionName} · {policy.academicYear} (Semester {policy.semester})
              </p>
            </>
          )}
          {user.role === 'admin' && (
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-[#6B5A4C]">Section:</label>
              <select
                value={selectedSectionId}
                onChange={(e) => setSelectedSectionId(e.target.value)}
                className="rounded border border-[#E3D2B4] bg-white px-3 py-1.5 text-sm text-[#241710]"
              >
                {activeSections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.displayName} (Room {sec.defaultClassroom})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 no-print self-start">
          {user.role === 'faculty' && activeSections.length > 0 && (
            <select
              value={selectedSectionId}
              onChange={(e) => setSelectedSectionId(e.target.value)}
              className="rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
            >
              {activeSections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.displayName}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-2 rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3.5 py-2 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3]"
          >
            <Download className="w-3.5 h-3.5 text-[#DF6A24]" />
            <span>Download CSV</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded bg-[#165B33] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#104526]"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {user.role === 'student' ? (
        <div className="rounded-md border border-[#E3D2B4] bg-white overflow-hidden">
          <div className="border-b border-[#E3D2B4] px-5 py-4 flex flex-wrap items-center justify-between gap-4 bg-[#FFFDF8]">
            <div>
              <div className="text-sm font-semibold text-[#165B33]">{user.name}</div>
              <div className="text-xs text-[#6B5A4C]">
                <span className="font-mono">{user.identifier}</span> ·{' '}
                {user.sectionDisplayName || `CSBS ${user.section}`} · Semester {user.semester}
              </div>
            </div>
            <div className="text-xs text-[#6B5A4C]">{policy.institutionName}</div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E3D2B4] text-xs font-semibold text-[#6B5A4C]">
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Course</th>
                  <th className="py-3 px-4">Attended</th>
                  <th className="py-3 px-4">Attendance</th>
                  <th className="py-3 px-4">Required</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3D2B4] text-sm">
                {studentReportRows.map((m) => (
                  <tr key={m.subject.id}>
                    <td className="py-3 px-4 font-mono text-xs text-[#6B5A4C]">{m.subject.code}</td>
                    <td className="py-3 px-4 font-medium text-[#241710]">{m.subject.name}</td>
                    <td className="py-3 px-4 tabular-nums text-[#241710]">
                      {m.attended} / {m.conducted}
                    </td>
                    <td className="py-3 px-4 tabular-nums font-medium text-[#241710]">
                      {m.percentage !== null ? `${Math.round(m.percentage)}%` : '—'}
                    </td>
                    <td className="py-3 px-4 tabular-nums text-[#6B5A4C]">
                      {m.requiredPercentage}%
                    </td>
                    <td className="py-3 px-4">
                      <StandingIndicator standing={m.standing} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                <th className="py-3 px-4 w-44">USN</th>
                <th className="py-3 px-4">Student Name</th>
                <th className="py-3 px-4">Classes Attended</th>
                <th className="py-3 px-4">Overall Attendance</th>
                <th className="py-3 px-4">Courses Below {policy.defaultMinimumPercentage}%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3D2B4] text-sm">
              {sectionSummaryRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 px-4 text-center text-[#6B5A4C]">
                    No students enrolled in this section.
                  </td>
                </tr>
              ) : (
                sectionSummaryRows.map((row) => (
                  <tr key={row.student.id} className="hover:bg-[#FAF3E3]/55">
                    <td className="py-3 px-4 font-mono text-xs text-[#241710]">
                      {row.student.identifier}
                    </td>
                    <td className="py-3 px-4 font-medium text-[#241710]">{row.student.name}</td>
                    <td className="py-3 px-4 tabular-nums text-[#241710]">
                      {row.attended} / {row.conducted}
                    </td>
                    <td className="py-3 px-4 tabular-nums font-medium text-[#241710]">
                      {row.percentage !== null ? `${row.percentage.toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-3 px-4">
                      {row.belowCount > 0 ? (
                        <span className="font-medium text-[#B42318]">
                          {row.belowCount} {row.belowCount === 1 ? 'course' : 'courses'}
                        </span>
                      ) : (
                        <span className="text-[#165B33]">None</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {auditLogs.length > 0 && user.role !== 'admin' && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-[#165B33]">Verified Register Updates</h2>
          <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Course</th>
                  <th className="py-3 px-4">Status Update</th>
                  <th className="py-3 px-4">Verified By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3D2B4] text-sm">
                {auditLogs.slice(0, 8).map((log) => (
                  <tr key={log.id}>
                    <td className="py-3 px-4 text-[#6B5A4C] whitespace-nowrap">
                      {formatShortDate(log.timestamp)}
                    </td>
                    <td className="py-3 px-4 text-[#241710]">{log.subjectName || log.action}</td>
                    <td className="py-3 px-4 text-[#241710]">
                      {log.previousValue ? `${log.previousValue} → ${log.newValue}` : log.newValue}
                    </td>
                    <td className="py-3 px-4 text-[#6B5A4C]">{log.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
