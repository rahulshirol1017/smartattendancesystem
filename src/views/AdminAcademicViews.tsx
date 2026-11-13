import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Grid3X3, Printer, X } from 'lucide-react';
import { api, ApiRequestError } from '../api/client.ts';
import { OfficialVTUTimetableDocument } from '../components/OfficialVTUTimetableDocument.tsx';
import {
  validateSessionConflicts,
  validateTimetableEntryConflicts,
} from '../shared/conflictCheck.ts';
import {
  AcademicSection,
  AttendanceAuditLog,
  ClassSession,
  ClassSessionType,
  ConflictDetail,
  FacultyAssignment,
  InstitutionalPolicy,
  SubjectItem,
  TimetableEntry,
  UserProfile,
} from '../shared/types.ts';

// ============================================================================
// 1. DEPARTMENTS & SECTIONS VIEW
// ============================================================================
export const AdminSectionsView: React.FC<{
  sections: AcademicSection[];
  facultyAssignments: FacultyAssignment[];
  timetable: TimetableEntry[];
  cohortUsers: UserProfile[];
  onRefreshWorkspace: () => Promise<void>;
}> = ({ sections, facultyAssignments, cohortUsers, onRefreshWorkspace }) => {
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [dept, setDept] = useState<string>('CSBS');
  const [secName, setSecName] = useState<string>('C');
  const [sem, setSem] = useState<number>(5);
  const [acadYear, setAcadYear] = useState<string>('2026');
  const [programme, setProgramme] = useState<string>(
    'B.Tech in Computer Science and Business Systems'
  );
  const [room, setRoom] = useState<string>('VB G20');
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await api.createSection({
        department: dept.trim().toUpperCase(),
        sectionName: secName.trim().toUpperCase(),
        semester: sem,
        academicYear: acadYear.trim(),
        programme: programme.trim(),
        defaultClassroom: room.trim(),
      });
      await onRefreshWorkspace();
      setShowAdd(false);
      setFeedback({ type: 'success', text: 'Section added.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not add section.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#165B33]">CSBS Sections</h1>
          <p className="mt-1 text-sm text-[#6B5A4C]">
            Academic sections, classrooms, and enrolled strength.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="self-start rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
        >
          Add Section
        </button>
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

      <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
              <th className="py-3 px-4">Section</th>
              <th className="py-3 px-4">Department</th>
              <th className="py-3 px-4">Semester</th>
              <th className="py-3 px-4">Room</th>
              <th className="py-3 px-4">Students</th>
              <th className="py-3 px-4">Courses Assigned</th>
              <th className="py-3 px-4 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3D2B4] text-sm">
            {sections.map((sec) => {
              const stuCount = cohortUsers.filter(
                (u) => u.role === 'student' && u.sectionId === sec.id
              ).length;
              const subjCount = facultyAssignments.filter(
                (fa) => fa.sectionId === sec.id && fa.status === 'Active'
              ).length;

              return (
                <tr key={sec.id} className="hover:bg-[#FAF3E3]/55">
                  <td className="py-3.5 px-4 font-semibold text-[#165B33]">{sec.displayName}</td>
                  <td className="py-3.5 px-4 text-[#241710]">{sec.department}</td>
                  <td className="py-3.5 px-4 tabular-nums text-[#241710]">Sem {sec.semester}</td>
                  <td className="py-3.5 px-4 text-[#6B5A4C]">{sec.defaultClassroom}</td>
                  <td className="py-3.5 px-4 tabular-nums text-[#241710]">{stuCount}</td>
                  <td className="py-3.5 px-4 tabular-nums text-[#241710]">{subjCount}</td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={async () => {
                        await api.updateSection(sec.id, {
                          status: sec.status === 'Active' ? 'Archived' : 'Active',
                        });
                        await onRefreshWorkspace();
                      }}
                      className={`text-xs font-medium hover:underline ${
                        sec.status === 'Active' ? 'text-[#165B33]' : 'text-[#6B5A4C]'
                      }`}
                    >
                      {sec.status}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#241710]/50 p-4">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-md rounded-md border border-[#E3D2B4] bg-white p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#E3D2B4] pb-3">
              <h2 className="text-base font-semibold text-[#165B33]">Add Section</h2>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="p-1 text-[#6B5A4C] hover:text-[#241710]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Department</label>
                <input
                  type="text"
                  required
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Section</label>
                <input
                  type="text"
                  required
                  value={secName}
                  onChange={(e) => setSecName(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Semester</label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={sem}
                  onChange={(e) => setSem(Number(e.target.value))}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Room</label>
                <input
                  type="text"
                  required
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Programme</label>
                <input
                  type="text"
                  required
                  value={programme}
                  onChange={(e) => setProgramme(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Academic Year
                </label>
                <input
                  type="text"
                  required
                  value={acadYear}
                  onChange={(e) => setAcadYear(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-4 py-2 text-xs font-medium text-[#241710]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
              >
                {busy ? 'Saving…' : 'Add Section'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 2. SUBJECTS / COURSES VIEW
// ============================================================================
export const AdminSubjectsView: React.FC<{
  policy: InstitutionalPolicy;
  subjects: SubjectItem[];
  facultyAssignments: FacultyAssignment[];
  cohortUsers: UserProfile[];
  onRefreshWorkspace: () => Promise<void>;
}> = ({ policy, subjects, cohortUsers, onRefreshWorkspace }) => {
  const facultyMembers = useMemo(
    () => cohortUsers.filter((u) => u.role === 'faculty'),
    [cohortUsers]
  );

  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [code, setCode] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [dept, setDept] = useState<string>('CSBS');
  const [sem, setSem] = useState<number>(policy.semester || 5);
  const [credits, setCredits] = useState<number>(4);
  const [minReq, setMinReq] = useState<number>(policy.defaultMinimumPercentage || 85);
  const [coordId, setCoordId] = useState<string>(() => facultyMembers[0]?.id || '');
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const coord = facultyMembers.find((f) => f.id === coordId);
      await api.createSubject({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        department: dept.trim().toUpperCase(),
        semester: sem,
        programme: policy.programme,
        credits,
        attendanceRequirement: minReq,
        assignedFacultyId: coord?.id || '',
        assignedFacultyName: coord?.name || 'Course Coordinator',
        academicYear: policy.academicYear,
        estimatedRemainingClasses: 20,
      });
      await onRefreshWorkspace();
      setShowAdd(false);
      setCode('');
      setName('');
      setFeedback({ type: 'success', text: 'Course added.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not add course.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[#6B5A4C]">{subjects.length} V-Semester CSBS courses</span>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
        >
          Add Course
        </button>
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

      <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
              <th className="py-3 px-4">Code</th>
              <th className="py-3 px-4">Course Title</th>
              <th className="py-3 px-4">Department</th>
              <th className="py-3 px-4">Semester</th>
              <th className="py-3 px-4">Credits</th>
              <th className="py-3 px-4">Minimum Attendance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3D2B4] text-sm">
            {subjects.map((s) => (
              <tr key={s.id} className="hover:bg-[#FAF3E3]/55">
                <td className="py-3.5 px-4 font-mono text-xs text-[#DF6A24] font-semibold">
                  {s.code}
                </td>
                <td className="py-3.5 px-4 font-medium text-[#241710]">{s.name}</td>
                <td className="py-3.5 px-4 text-[#241710]">{s.department}</td>
                <td className="py-3.5 px-4 tabular-nums text-[#241710]">Sem {s.semester}</td>
                <td className="py-3.5 px-4 tabular-nums text-[#241710]">{s.credits}</td>
                <td className="py-3.5 px-4 tabular-nums font-medium text-[#165B33]">
                  {s.attendanceRequirement}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#241710]/50 p-4">
          <form
            onSubmit={handleAddSubject}
            className="w-full max-w-md rounded-md border border-[#E3D2B4] bg-white p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#E3D2B4] pb-3">
              <h2 className="text-base font-semibold text-[#165B33]">Add Course</h2>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="p-1 text-[#6B5A4C] hover:text-[#241710]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Course Code</label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="BCB501"
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm font-mono uppercase text-[#241710]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Department</label>
                <input
                  type="text"
                  required
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Course Title
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Fundamentals of Management"
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Semester</label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={sem}
                  onChange={(e) => setSem(Number(e.target.value))}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Minimum Attendance (%)
                </label>
                <input
                  type="number"
                  min={50}
                  max={100}
                  value={minReq}
                  onChange={(e) => setMinReq(Number(e.target.value))}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Credits</label>
                <input
                  type="number"
                  min={0}
                  max={6}
                  value={credits}
                  onChange={(e) => setCredits(Number(e.target.value))}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Coordinator</label>
                <select
                  value={coordId}
                  onChange={(e) => setCoordId(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                >
                  {facultyMembers.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-4 py-2 text-xs font-medium text-[#241710]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
              >
                {busy ? 'Saving…' : 'Add Course'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 3. SECTION TEACHER ASSIGNMENTS VIEW
// ============================================================================
export const AdminAssignmentsView: React.FC<{
  sections: AcademicSection[];
  subjects: SubjectItem[];
  facultyAssignments: FacultyAssignment[];
  cohortUsers: UserProfile[];
  onRefreshWorkspace: () => Promise<void>;
}> = ({ sections, subjects, facultyAssignments, cohortUsers, onRefreshWorkspace }) => {
  const activeSections = sections.filter((s) => s.status === 'Active');
  const facultyMembers = cohortUsers.filter(
    (u) => u.role === 'faculty' && u.accountStatus === 'Active'
  );

  const [sectionId, setSectionId] = useState<string>(() => activeSections[0]?.id || '');
  const [subjectId, setSubjectId] = useState<string>(() => subjects[0]?.id || '');
  const [facultyId, setFacultyId] = useState<string>(() => facultyMembers[0]?.id || '');
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await api.createFacultyAssignment({
        sectionId,
        subjectId,
        facultyId,
      });
      await onRefreshWorkspace();
      setFeedback({ type: 'success', text: 'Faculty assigned to section.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not assign faculty.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <form
        onSubmit={handleAssign}
        className="rounded-md border border-[#E3D2B4] bg-white p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Section</label>
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
          >
            {activeSections.map((sec) => (
              <option key={sec.id} value={sec.id}>
                {sec.displayName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Course</label>
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
          >
            {subjects.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.code} — {sub.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Faculty Member</label>
          <select
            value={facultyId}
            onChange={(e) => setFacultyId(e.target.value)}
            className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
          >
            {facultyMembers.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="rounded bg-[#165B33] px-4 py-2 text-sm font-medium text-white hover:bg-[#104526] disabled:opacity-50"
        >
          {busy ? 'Assigning…' : 'Assign Faculty'}
        </button>
      </form>

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

      <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
              <th className="py-3 px-4">Section</th>
              <th className="py-3 px-4">Course</th>
              <th className="py-3 px-4">Faculty</th>
              <th className="py-3 px-4 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3D2B4] text-sm">
            {facultyAssignments.map((fa) => (
              <tr key={fa.id} className="hover:bg-[#FAF3E3]/55">
                <td className="py-3.5 px-4 font-medium text-[#241710]">{fa.sectionDisplayName}</td>
                <td className="py-3.5 px-4">
                  <div className="font-medium text-[#241710]">{fa.subjectName}</div>
                  <div className="text-xs font-mono text-[#6B5A4C]">{fa.subjectCode}</div>
                </td>
                <td className="py-3.5 px-4 text-[#241710]">{fa.facultyName}</td>
                <td className="py-3.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={async () => {
                      await api.updateFacultyAssignment(fa.id, {
                        status: fa.status === 'Active' ? 'Inactive' : 'Active',
                      });
                      await onRefreshWorkspace();
                    }}
                    className={`text-xs font-medium hover:underline ${
                      fa.status === 'Active' ? 'text-[#165B33]' : 'text-[#6B5A4C]'
                    }`}
                  >
                    {fa.status}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ============================================================================
// 4. ADMIN TIMETABLE BUILDER VIEW
// ============================================================================
const DAYS: Array<'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday'> = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const AdminTimetableView: React.FC<{
  policy: InstitutionalPolicy;
  sections: AcademicSection[];
  facultyAssignments: FacultyAssignment[];
  timetable: TimetableEntry[];
  cohortUsers: UserProfile[];
  onRefreshWorkspace: () => Promise<void>;
}> = ({ policy, sections, facultyAssignments, timetable, cohortUsers, onRefreshWorkspace }) => {
  const activeSections = sections.filter((s) => s.status === 'Active');
  const [selectedSectionId, setSelectedSectionId] = useState<string>(
    () => activeSections[0]?.id || ''
  );

  const sectionAssignments = useMemo(
    () =>
      facultyAssignments.filter(
        (fa) => fa.sectionId === selectedSectionId && fa.status === 'Active'
      ),
    [facultyAssignments, selectedSectionId]
  );

  const [assignmentId, setAssignmentId] = useState<string>(
    () => sectionAssignments[0]?.id || ''
  );
  const [dayOfWeek, setDayOfWeek] = useState<TimetableEntry['dayOfWeek']>('Monday');
  const [startTime, setStartTime] = useState<string>('09:00');
  const [endTime, setEndTime] = useState<string>('10:00');
  const [classroom, setClassroom] = useState<string>('VB G19');
  const [batch, setBatch] = useState<'All' | 'B1' | 'B2'>('All');
  const [viewMode, setViewMode] = useState<'official' | 'manage'>('official');
  const [conflicts, setConflicts] = useState<ConflictDetail[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const adminUser = useMemo(
    () =>
      cohortUsers.find((u) => u.role === 'admin') || {
        id: 'adm-01',
        name: 'VTU Academic Registrar',
        role: 'admin' as const,
        identifier: 'ADM-01',
        email: 'admin@vtu.ac.in',
        college: 'VTU Campus, Jnana Sangama, Belagavi',
        department: 'CSBS',
        programme: 'B.Tech in CSBS',
        semester: 5,
        section: 'All',
        accountStatus: 'Active' as const,
        isDemo: true,
      },
    [cohortUsers]
  );

  useEffect(() => {
    setAssignmentId(sectionAssignments[0]?.id || '');
    const sec = activeSections.find((s) => s.id === selectedSectionId);
    if (sec?.defaultClassroom) setClassroom(sec.defaultClassroom);
  }, [selectedSectionId, sectionAssignments, activeSections]);

  const activeAssignObj = useMemo(
    () => sectionAssignments.find((a) => a.id === assignmentId) || sectionAssignments[0] || null,
    [sectionAssignments, assignmentId]
  );

  useEffect(() => {
    if (!activeAssignObj) {
      setConflicts([]);
      return;
    }
    const facUser = cohortUsers.find((u) => u.id === activeAssignObj.facultyId);
    const found = validateTimetableEntryConflicts({
      candidate: {
        sectionId: selectedSectionId,
        facultyId: activeAssignObj.facultyId,
        dayOfWeek,
        startTime,
        endTime,
        classroom,
        batch,
      },
      existingTimetable: timetable,
      facultyUser: facUser,
      checkRooms: policy.enforceRoomConflictCheck,
    });
    setConflicts(found);
  }, [
    activeAssignObj,
    selectedSectionId,
    dayOfWeek,
    startTime,
    endTime,
    classroom,
    batch,
    timetable,
    cohortUsers,
    policy.enforceRoomConflictCheck,
  ]);

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAssignObj) return;
    setBusy(true);
    setFeedback(null);
    try {
      await api.createTimetableEntry({
        facultyAssignmentId: activeAssignObj.id,
        dayOfWeek,
        period: `Slot (${startTime} - ${endTime})`,
        startTime,
        endTime,
        classroom,
        batch,
      });
      await onRefreshWorkspace();
      setFeedback({ type: 'success', text: 'Class added to CSBS timetable.' });
    } catch (err) {
      if (err instanceof ApiRequestError && err.conflicts) {
        setConflicts(err.conflicts);
      }
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not add timetable slot.',
      });
    } finally {
      setBusy(false);
    }
  };

  const sectionEntries = useMemo(
    () =>
      timetable
        .filter((t) => t.sectionId === selectedSectionId && t.status === 'Active')
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [timetable, selectedSectionId]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E3D2B4] pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#165B33]">CSBS Timetable</h1>
          <p className="mt-1 text-sm text-[#6B5A4C]">
            V-Semester schedule for CSBS A (VB G19) and CSBS B (VB G17) w.e.f 07/09/2026.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View mode toggle */}
          <div className="inline-flex rounded-md border border-[#E3D2B4] bg-[#FFFDF8] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('official')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold transition-colors ${
                viewMode === 'official'
                  ? 'bg-[#165B33] text-white shadow-xs'
                  : 'text-[#6B5A4C] hover:text-[#241710]'
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              <span>Official Document</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('manage')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold transition-colors ${
                viewMode === 'manage'
                  ? 'bg-[#165B33] text-white shadow-xs'
                  : 'text-[#6B5A4C] hover:text-[#241710]'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Manage Slots</span>
            </button>
          </div>

          <select
            aria-label="Select section"
            value={selectedSectionId}
            onChange={(e) => setSelectedSectionId(e.target.value)}
            className="rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
          >
            {activeSections.map((sec) => (
              <option key={sec.id} value={sec.id}>
                {sec.displayName} (Room {sec.defaultClassroom})
              </option>
            ))}
          </select>
        </div>
      </div>

      {viewMode === 'official' ? (
        <OfficialVTUTimetableDocument
          sectionId={selectedSectionId}
          activeUser={adminUser}
          timetable={timetable}
          classes={[]}
        />
      ) : (
        <div className="space-y-6">

      <form
        onSubmit={handleAddSlot}
        className="rounded-md border border-[#E3D2B4] bg-white p-4 space-y-3"
      >
        <div className="text-sm font-semibold text-[#165B33]">Add Weekly Slot</div>

        {conflicts.length > 0 && (
          <div className="rounded border border-[#B42318]/40 bg-[#FFFDF8] p-3 text-xs text-[#B42318] space-y-1">
            {conflicts.map((c, i) => (
              <div key={i}>• {c.message}</div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
              Course & Faculty
            </label>
            <select
              value={activeAssignObj?.id || ''}
              onChange={(e) => setAssignmentId(e.target.value)}
              className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
            >
              {sectionAssignments.map((fa) => (
                <option key={fa.id} value={fa.id}>
                  {fa.subjectCode} {fa.subjectName} ({fa.facultyName})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Day</label>
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(e.target.value as TimetableEntry['dayOfWeek'])}
              className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Batch</label>
            <select
              value={batch}
              onChange={(e) => setBatch(e.target.value as 'All' | 'B1' | 'B2')}
              className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
            >
              <option value="All">All Batches</option>
              <option value="B1">Batch B1</option>
              <option value="B2">Batch B2</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Start</label>
            <input
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#6B5A4C] mb-1">End</label>
            <input
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Room</label>
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={classroom}
                onChange={(e) => setClassroom(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-2.5 py-2 text-sm text-[#241710]"
              />
              <button
                type="submit"
                disabled={busy || conflicts.length > 0 || !activeAssignObj}
                className="rounded bg-[#165B33] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#104526] disabled:opacity-50 whitespace-nowrap"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </form>

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

      <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
        <div className="grid grid-cols-6 divide-x divide-[#E3D2B4] min-w-[920px]">
          {DAYS.map((day) => {
            const slots = sectionEntries.filter((e) => e.dayOfWeek === day);
            return (
              <div key={day} className="flex flex-col">
                <div className="border-b border-[#E3D2B4] bg-[#165B33] px-3.5 py-3 text-xs font-semibold text-white">
                  {day}
                </div>
                <div className="p-2.5 space-y-2.5 flex-1 bg-[#FFFDF8]">
                  {slots.length === 0 ? (
                    <div className="py-6 text-center text-xs text-[#6B5A4C]">No classes</div>
                  ) : (
                    slots.map((slot) => (
                      <div
                        key={slot.id}
                        className="rounded border border-[#E3D2B4] bg-white p-3 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-mono font-semibold text-[#DF6A24]">
                            {slot.subjectCode}
                          </span>
                          <span className="text-[11px] font-semibold text-[#165B33] tabular-nums">
                            {slot.startTime}–{slot.endTime}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-[#241710] leading-snug">
                          {slot.subjectName}
                        </div>
                        <div className="text-[11px] text-[#6B5A4C]">
                          {slot.classroom} · {slot.facultyName}
                        </div>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={async () => {
                              await api.deleteTimetableEntry(slot.id);
                              await onRefreshWorkspace();
                            }}
                            className="text-[11px] text-[#B42318] hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 5. EXTRA CLASSES & RESCHEDULING VIEW
// ============================================================================
export const AdminExtraClassesView: React.FC<{
  policy: InstitutionalPolicy;
  sections: AcademicSection[];
  subjects: SubjectItem[];
  facultyAssignments: FacultyAssignment[];
  classes: ClassSession[];
  timetable: TimetableEntry[];
  cohortUsers: UserProfile[];
  onRefreshWorkspace: () => Promise<void>;
}> = ({
  policy,
  sections,
  facultyAssignments,
  classes,
  timetable,
  cohortUsers,
  onRefreshWorkspace,
}) => {
  const activeAssignments = facultyAssignments.filter((fa) => fa.status === 'Active');
  const facultyMembers = cohortUsers.filter(
    (u) => u.role === 'faculty' && u.accountStatus === 'Active'
  );

  const [showSchedule, setShowSchedule] = useState<boolean>(false);
  const [assignmentId, setAssignmentId] = useState<string>(() => activeAssignments[0]?.id || '');
  const [sessionType, setSessionType] = useState<ClassSessionType>('Extra');
  const [date, setDate] = useState<string>('2026-10-30');
  const [startTime, setStartTime] = useState<string>('15:15');
  const [endTime, setEndTime] = useState<string>('16:15');
  const [classroom, setClassroom] = useState<string>('VB G19');
  const [actualFacultyId, setActualFacultyId] = useState<string>(
    () => activeAssignments[0]?.facultyId || ''
  );
  const [topic, setTopic] = useState<string>('');
  const [conflicts, setConflicts] = useState<ConflictDetail[]>([]);
  const [busy, setBusy] = useState<boolean>(false);

  const selectedAssignment = useMemo(
    () => activeAssignments.find((a) => a.id === assignmentId) || activeAssignments[0] || null,
    [activeAssignments, assignmentId]
  );

  useEffect(() => {
    if (selectedAssignment) {
      setActualFacultyId(selectedAssignment.facultyId);
      const sec = sections.find((s) => s.id === selectedAssignment.sectionId);
      if (sec?.defaultClassroom) setClassroom(sec.defaultClassroom);
    }
  }, [selectedAssignment, sections]);

  useEffect(() => {
    if (!selectedAssignment) {
      setConflicts([]);
      return;
    }
    const facUser = cohortUsers.find((u) => u.id === actualFacultyId);
    setConflicts(
      validateSessionConflicts({
        candidate: {
          sectionId: selectedAssignment.sectionId,
          date,
          startTime,
          endTime,
          classroom,
          actualFacultyId,
        },
        existingSessions: classes,
        existingTimetable: timetable,
        facultyUser: facUser,
        checkRooms: policy.enforceRoomConflictCheck,
      })
    );
  }, [
    selectedAssignment,
    date,
    startTime,
    endTime,
    classroom,
    actualFacultyId,
    classes,
    timetable,
    cohortUsers,
    policy.enforceRoomConflictCheck,
  ]);

  const specialSessions = useMemo(
    () =>
      classes
        .filter((c) => c.sessionType !== 'Regular' || c.isSubstitute)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [classes]
  );

  const handleCreateExtra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignment) return;
    setBusy(true);
    try {
      await api.createExtraClass({
        sectionId: selectedAssignment.sectionId,
        subjectId: selectedAssignment.subjectId,
        sessionType,
        date,
        period: `${sessionType} (${startTime} - ${endTime})`,
        startTime,
        endTime,
        classroom,
        topic: topic.trim() || `${sessionType} class`,
        actualFacultyId,
        reason: 'Scheduled academic session',
      });
      await onRefreshWorkspace();
      setShowSchedule(false);
      setTopic('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#165B33]">Extra Classes</h1>
          <p className="mt-1 text-sm text-[#6B5A4C]">
            Schedule extra, make-up, or substitute CSBS sessions.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowSchedule((prev) => !prev)}
          className="self-start rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
        >
          {showSchedule ? 'Close Form' : 'Schedule Extra Class'}
        </button>
      </div>

      {showSchedule && (
        <form
          onSubmit={handleCreateExtra}
          className="rounded-md border border-[#E3D2B4] bg-white p-5 space-y-4 max-w-3xl"
        >
          {conflicts.length > 0 && (
            <div className="rounded border border-[#B42318]/40 bg-[#FFFDF8] p-3 text-xs text-[#B42318] space-y-1">
              {conflicts.map((c, idx) => (
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
                value={selectedAssignment?.id || ''}
                onChange={(e) => setAssignmentId(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              >
                {activeAssignments.map((fa) => (
                  <option key={fa.id} value={fa.id}>
                    {fa.sectionDisplayName} — {fa.subjectCode} {fa.subjectName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                Conducting Faculty
              </label>
              <select
                value={actualFacultyId}
                onChange={(e) => setActualFacultyId(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              >
                {facultyMembers.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Class Type</label>
              <select
                value={sessionType}
                onChange={(e) => setSessionType(e.target.value as ClassSessionType)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              >
                <option value="Extra">Extra Class</option>
                <option value="Replacement">Make-up Class</option>
                <option value="Swapped">Substitute / Swapped Class</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Start Time</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">End Time</label>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Room</label>
              <input
                type="text"
                required
                value={classroom}
                onChange={(e) => setClassroom(e.target.value)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Topic</label>
              <input
                type="text"
                required
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Topic covered"
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy || conflicts.length > 0}
            className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526] disabled:opacity-50"
          >
            {busy ? 'Scheduling…' : 'Save Extra Class'}
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
              <th className="py-3 px-4">Date & Time</th>
              <th className="py-3 px-4">Section</th>
              <th className="py-3 px-4">Course</th>
              <th className="py-3 px-4">Faculty</th>
              <th className="py-3 px-4">Type</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3D2B4] text-sm">
            {specialSessions.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 px-4 text-center text-[#6B5A4C]">
                  No extra or substitute classes scheduled.
                </td>
              </tr>
            ) : (
              specialSessions.map((s) => (
                <tr key={s.id} className="hover:bg-[#FAF3E3]/55">
                  <td className="py-3.5 px-4 tabular-nums whitespace-nowrap">
                    <div className="font-medium text-[#241710]">{s.date}</div>
                    <div className="text-xs text-[#6B5A4C]">
                      {s.startTime} – {s.endTime} · {s.classroom}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-medium text-[#241710]">{s.sectionDisplayName}</td>
                  <td className="py-3.5 px-4 text-[#241710]">{s.subjectName || s.topic}</td>
                  <td className="py-3.5 px-4 text-[#241710]">
                    {s.facultyName}
                    {s.isSubstitute && (
                      <span className="ml-1.5 text-xs text-[#DF6A24]">(Substitute)</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-[#6B5A4C]">{s.sessionType}</td>
                  <td className="py-3.5 px-4">
                    <span
                      className={`text-xs font-medium ${
                        s.approvalStatus === 'Approved'
                          ? 'text-[#165B33]'
                          : s.approvalStatus === 'Rejected'
                          ? 'text-[#B42318]'
                          : 'text-[#B45309]'
                      }`}
                    >
                      {s.status === 'Cancelled' ? 'Cancelled' : s.approvalStatus}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-3">
                    {s.approvalStatus === 'Pending Approval' && (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            await api.updateExtraClass(s.id, { action: 'approve' });
                            await onRefreshWorkspace();
                          }}
                          className="text-xs font-medium text-[#165B33] hover:underline"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await api.updateExtraClass(s.id, { action: 'reject' });
                            await onRefreshWorkspace();
                          }}
                          className="text-xs font-medium text-[#B42318] hover:underline"
                        >
                          Decline
                        </button>
                      </>
                    )}
                    {s.status !== 'Cancelled' && s.status !== 'Conducted' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.updateExtraClass(s.id, {
                            action: 'cancel',
                            reason: 'Cancelled',
                          });
                          await onRefreshWorkspace();
                        }}
                        className="text-xs text-[#6B5A4C] hover:text-[#B42318] hover:underline"
                      >
                        Cancel
                      </button>
                    )}
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

// ============================================================================
// 6. AUDIT LOGS VIEW
// ============================================================================
export const AdminAuditLogsView: React.FC<{
  auditLogs: AttendanceAuditLog[];
}> = ({ auditLogs }) => {
  return (
    <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
            <th className="py-3 px-4">Date</th>
            <th className="py-3 px-4">Action</th>
            <th className="py-3 px-4">Student / Section</th>
            <th className="py-3 px-4">Status Change</th>
            <th className="py-3 px-4">Verified By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E3D2B4] text-sm">
          {auditLogs.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-8 px-4 text-center text-[#6B5A4C]">
                No audit entries recorded.
              </td>
            </tr>
          ) : (
            auditLogs.map((log) => (
              <tr key={log.id} className="hover:bg-[#FAF3E3]/55">
                <td className="py-3 px-4 text-xs text-[#6B5A4C] whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </td>
                <td className="py-3 px-4 font-medium text-[#241710]">{log.action}</td>
                <td className="py-3 px-4 text-[#241710]">
                  {log.studentName || log.sectionDisplayName || '—'}
                </td>
                <td className="py-3 px-4 text-[#241710]">
                  {log.previousValue ? `${log.previousValue} → ${log.newValue}` : log.newValue}
                </td>
                <td className="py-3 px-4 text-[#6B5A4C]">{log.actorName}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};
