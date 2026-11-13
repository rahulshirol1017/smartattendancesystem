import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api, BulkCsvRowPayload, BulkPreviewResult } from '../api/client.ts';
import {
  AcademicSection,
  AttendanceCorrectionRequest,
  AttendanceRecord,
  ClassSession,
  FacultyAssignment,
  FacultyUnavailabilitySlot,
  InstitutionalPolicy,
  NavigationSection,
  SubjectItem,
  TimetableEntry,
  UserProfile,
} from '../shared/types.ts';

// ============================================================================
// 1. ADMIN STUDENTS VIEW
// ============================================================================
interface AdminStudentsViewProps {
  policy: InstitutionalPolicy;
  sections: AcademicSection[];
  subjects: SubjectItem[];
  facultyAssignments: FacultyAssignment[];
  classes: ClassSession[];
  records: AttendanceRecord[];
  corrections: AttendanceCorrectionRequest[];
  timetable: TimetableEntry[];
  cohortUsers: UserProfile[];
  onRefreshWorkspace: () => Promise<void>;
}

function parseSimpleCsv(rawText: string): BulkCsvRowPayload[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return [];

  return lines.slice(1).map((line, idx) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    return {
      rowNumber: idx + 2,
      name: cols[0] || '',
      usn: cols[1] || '',
      email: cols[2] || '',
      department: cols[3] || 'CSBS',
      section: cols[4] || 'A',
      semester: cols[5] || '5',
      academicYear: cols[6] || '2026',
      rollNumber: cols[7] || '',
      accountStatus: cols[8] || 'Active',
    };
  });
}

export const AdminStudentsView: React.FC<AdminStudentsViewProps> = ({
  policy,
  sections,
  cohortUsers,
  onRefreshWorkspace,
}) => {
  const activeSections = useMemo(
    () => sections.filter((s) => s.status === 'Active'),
    [sections]
  );

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sectionFilter, setSectionFilter] = useState<string>('all');

  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [editingStudent, setEditingStudent] = useState<UserProfile | null>(null);
  const [showCsvModal, setShowCsvModal] = useState<boolean>(false);

  const [newName, setNewName] = useState<string>('');
  const [newUsn, setNewUsn] = useState<string>('');
  const [newEmail, setNewEmail] = useState<string>('');
  const [newSectionId, setNewSectionId] = useState<string>(() => activeSections[0]?.id || '');
  const [newSemester, setNewSemester] = useState<number>(policy.semester || 5);
  const [newRoll, setNewRoll] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');

  const [editName, setEditName] = useState<string>('');
  const [editEmail, setEditEmail] = useState<string>('');
  const [editSectionId, setEditSectionId] = useState<string>('');
  const [editSemester, setEditSemester] = useState<number>(5);
  const [editStatus, setEditStatus] = useState<'Active' | 'Inactive' | 'Suspended'>('Active');

  const [csvText, setCsvText] = useState<string>(
    'Name,USN,Email,Department,Section,Semester,AcademicYear,RollNumber,Status\nKiran Patil,2VX24CB015,2vx24cb015@vtu.ac.in,CSBS,A,5,2026,15,Active'
  );
  const [csvRows, setCsvRows] = useState<BulkCsvRowPayload[]>([]);
  const [csvPreview, setCsvPreview] = useState<BulkPreviewResult | null>(null);

  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const students = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cohortUsers
      .filter((u) => u.role === 'student')
      .filter((u) => (sectionFilter === 'all' ? true : u.sectionId === sectionFilter))
      .filter((u) =>
        !q
          ? true
          : u.name.toLowerCase().includes(q) ||
            u.identifier.toLowerCase().includes(q) ||
            u.department.toLowerCase().includes(q)
      )
      .sort((a, b) => a.identifier.localeCompare(b.identifier));
  }, [cohortUsers, searchQuery, sectionFilter]);

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await api.createStudent({
        name: newName.trim(),
        identifier: newUsn.trim().toUpperCase(),
        email: newEmail.trim().toLowerCase(),
        sectionId: newSectionId,
        semester: newSemester,
        academicYear: policy.academicYear,
        rollNumber: newRoll.trim() || undefined,
        password: newPassword.trim() || undefined,
      });
      await onRefreshWorkspace();
      setShowAddModal(false);
      setNewName('');
      setNewUsn('');
      setNewEmail('');
      setNewRoll('');
      setNewPassword('');
      setFeedback({ type: 'success', text: 'Student added.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not add student.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openEditModal = (stu: UserProfile) => {
    setEditingStudent(stu);
    setEditName(stu.name);
    setEditEmail(stu.email);
    setEditSectionId(stu.sectionId || activeSections[0]?.id || '');
    setEditSemester(stu.semester);
    setEditStatus(stu.accountStatus);
  };

  const handleUpdateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    setBusy(true);
    setFeedback(null);
    try {
      await api.updateStudent(editingStudent.id, {
        name: editName.trim(),
        email: editEmail.trim().toLowerCase(),
        sectionId: editSectionId,
        semester: editSemester,
        accountStatus: editStatus,
        reason: 'Directory update',
      });
      await onRefreshWorkspace();
      setEditingStudent(null);
      setFeedback({ type: 'success', text: 'Student record updated.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update student.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePreviewCsv = async () => {
    const parsed = parseSimpleCsv(csvText);
    setCsvRows(parsed);
    if (parsed.length === 0) {
      setFeedback({ type: 'error', text: 'Enter at least one student row below the header.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const preview = await api.previewBulkStudents(parsed);
      setCsvPreview(preview);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not validate CSV rows.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleImportCsv = async () => {
    if (csvRows.length === 0) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api.importBulkStudents(csvRows);
      await onRefreshWorkspace();
      setShowCsvModal(false);
      setCsvPreview(null);
      setFeedback({
        type: 'success',
        text: `Imported ${res.importedCount} ${res.importedCount === 1 ? 'student' : 'students'}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not import students.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#165B33]">Students</h1>
          <p className="mt-1 text-sm text-[#6B5A4C]">CSBS A & CSBS B student directory.</p>
        </div>

        <div className="flex items-center gap-2.5 self-start">
          <button
            type="button"
            onClick={() => {
              setCsvPreview(null);
              setShowCsvModal(true);
            }}
            className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3.5 py-2 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3]"
          >
            Import CSV
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
          >
            Add Student
          </button>
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-[#6B5A4C] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by student name or USN"
            className="w-full rounded border border-[#E3D2B4] bg-white pl-9 pr-3 py-2 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
          />
        </div>

        <select
          aria-label="Filter by section"
          value={sectionFilter}
          onChange={(e) => setSectionFilter(e.target.value)}
          className="rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710] self-start"
        >
          <option value="all">
            All Sections ({cohortUsers.filter((u) => u.role === 'student').length})
          </option>
          {activeSections.map((sec) => (
            <option key={sec.id} value={sec.id}>
              {sec.displayName} (Sem {sec.semester})
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
              <th className="py-3 px-4">Student Name</th>
              <th className="py-3 px-4">USN</th>
              <th className="py-3 px-4">Department</th>
              <th className="py-3 px-4">Section</th>
              <th className="py-3 px-4">Semester</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3D2B4] text-sm">
            {students.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 px-4 text-center text-[#6B5A4C]">
                  No students match your filter.
                </td>
              </tr>
            ) : (
              students.map((stu) => (
                <tr key={stu.id} className="hover:bg-[#FAF3E3]/55">
                  <td className="py-3.5 px-4">
                    <div className="font-medium text-[#241710]">{stu.name}</div>
                    <div className="text-xs text-[#6B5A4C]">{stu.email}</div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs text-[#241710] whitespace-nowrap">
                    {stu.identifier}
                  </td>
                  <td className="py-3.5 px-4 text-[#241710]">{stu.department}</td>
                  <td className="py-3.5 px-4 font-medium text-[#241710]">
                    {stu.sectionDisplayName || stu.section}
                  </td>
                  <td className="py-3.5 px-4 tabular-nums text-[#241710]">{stu.semester}</td>
                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openEditModal(stu)}
                      className="text-xs font-medium text-[#DF6A24] hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#241710]/50 p-4">
          <form
            onSubmit={handleAddStudent}
            className="w-full max-w-lg rounded-md border border-[#E3D2B4] bg-white p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#E3D2B4] pb-3">
              <h2 className="text-base font-semibold text-[#165B33]">Add Student</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-[#6B5A4C] hover:text-[#241710]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">USN</label>
                <input
                  type="text"
                  required
                  value={newUsn}
                  onChange={(e) => setNewUsn(e.target.value)}
                  placeholder="e.g. 2VX24CB010"
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm font-mono uppercase text-[#241710]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Section</label>
                <select
                  value={newSectionId}
                  onChange={(e) => setNewSectionId(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                >
                  {activeSections.map((sec) => (
                    <option key={sec.id} value={sec.id}>
                      {sec.displayName} (Sem {sec.semester})
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  University Email
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="usn@vtu.ac.in"
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Semester</label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={newSemester}
                  onChange={(e) => setNewSemester(Number(e.target.value))}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Roll Number (optional)
                </label>
                <input
                  type="text"
                  value={newRoll}
                  onChange={(e) => setNewRoll(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Initial Password (optional)
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-4 py-2 text-xs font-medium text-[#241710]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
              >
                {busy ? 'Adding…' : 'Add Student'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#241710]/50 p-4">
          <form
            onSubmit={handleUpdateStudent}
            className="w-full max-w-lg rounded-md border border-[#E3D2B4] bg-white p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#E3D2B4] pb-3">
              <div>
                <h2 className="text-base font-semibold text-[#165B33]">Edit Student</h2>
                <p className="text-xs font-mono text-[#6B5A4C]">{editingStudent.identifier}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingStudent(null)}
                className="p-1 text-[#6B5A4C] hover:text-[#241710]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Section</label>
                <select
                  value={editSectionId}
                  onChange={(e) => setEditSectionId(e.target.value)}
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
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Semester</label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={editSemester}
                  onChange={(e) => setEditSemester(Number(e.target.value))}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Account Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) =>
                    setEditStatus(e.target.value as 'Active' | 'Inactive' | 'Suspended')
                  }
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditingStudent(null)}
                className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-4 py-2 text-xs font-medium text-[#241710]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
              >
                {busy ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showCsvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#241710]/50 p-4">
          <div className="w-full max-w-2xl rounded-md border border-[#E3D2B4] bg-white p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E3D2B4] pb-3">
              <h2 className="text-base font-semibold text-[#165B33]">Import Students from CSV</h2>
              <button
                type="button"
                onClick={() => setShowCsvModal(false)}
                className="p-1 text-[#6B5A4C] hover:text-[#241710]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-[#6B5A4C]">
                Name, USN, Email, Department, Section, Semester, AcademicYear, RollNumber, Status
              </label>
              <textarea
                rows={6}
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value);
                  setCsvPreview(null);
                }}
                className="w-full rounded border border-[#E3D2B4] bg-white p-3 font-mono text-xs text-[#241710]"
              />
            </div>

            {csvPreview && (
              <div className="rounded border border-[#E3D2B4] bg-[#FFFDF8] p-3 text-xs space-y-1">
                <div>
                  Valid rows:{' '}
                  <strong className="text-[#165B33]">{csvPreview.validRows.length}</strong>
                </div>
                {csvPreview.duplicateRows.length > 0 && (
                  <div className="text-[#B45309]">
                    Duplicates skipped: {csvPreview.duplicateRows.length}
                  </div>
                )}
                {csvPreview.invalidRows.length > 0 && (
                  <div className="text-[#B42318]">
                    Invalid rows: {csvPreview.invalidRows.length}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowCsvModal(false)}
                className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-4 py-2 text-xs font-medium text-[#241710]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handlePreviewCsv}
                className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-4 py-2 text-xs font-medium text-[#165B33] hover:bg-[#FAF3E3]"
              >
                Check Rows
              </button>
              {csvPreview && csvPreview.validRows.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleImportCsv}
                  className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
                >
                  Import {csvPreview.validRows.length} Students
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 2. ADMIN FACULTY VIEW
// ============================================================================
interface AdminFacultyViewProps {
  facultyAssignments: FacultyAssignment[];
  timetable: TimetableEntry[];
  cohortUsers: UserProfile[];
  onNavigate: (section: NavigationSection) => void;
  onRefreshWorkspace: () => Promise<void>;
}

export const AdminFacultyView: React.FC<AdminFacultyViewProps> = ({
  facultyAssignments,
  cohortUsers,
  onNavigate,
  onRefreshWorkspace,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [editingFaculty, setEditingFaculty] = useState<UserProfile | null>(null);

  const [newName, setNewName] = useState<string>('');
  const [newId, setNewId] = useState<string>('');
  const [newEmail, setNewEmail] = useState<string>('');
  const [newDept, setNewDept] = useState<string>('CSBS');
  const [newDesignation, setNewDesignation] = useState<string>('Assistant Professor');
  const [newPhone, setNewPhone] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');

  const [editName, setEditName] = useState<string>('');
  const [editDept, setEditDept] = useState<string>('');
  const [editDesignation, setEditDesignation] = useState<string>('');
  const [editSlots, setEditSlots] = useState<FacultyUnavailabilitySlot[]>([]);
  const [slotDay, setSlotDay] =
    useState<NonNullable<FacultyUnavailabilitySlot['dayOfWeek']>>('Friday');
  const [slotStart, setSlotStart] = useState<string>('14:15');
  const [slotEnd, setSlotEnd] = useState<string>('16:15');
  const [slotReason, setSlotReason] = useState<string>('Department duty');

  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const facultyList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cohortUsers
      .filter((u) => u.role === 'faculty')
      .filter((u) =>
        !q
          ? true
          : u.name.toLowerCase().includes(q) ||
            u.identifier.toLowerCase().includes(q) ||
            u.department.toLowerCase().includes(q)
      )
      .sort((a, b) => a.identifier.localeCompare(b.identifier));
  }, [cohortUsers, searchQuery]);

  const handleAddFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await api.createFaculty({
        name: newName.trim(),
        identifier: newId.trim().toUpperCase(),
        email: newEmail.trim().toLowerCase(),
        department: newDept.trim().toUpperCase(),
        designation: newDesignation.trim(),
        phone: newPhone.trim() || undefined,
        password: newPassword.trim() || undefined,
      });
      await onRefreshWorkspace();
      setShowAddModal(false);
      setNewName('');
      setNewId('');
      setNewEmail('');
      setNewPhone('');
      setNewPassword('');
      setFeedback({ type: 'success', text: 'Faculty member added.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not add faculty member.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openEditFaculty = (fac: UserProfile) => {
    setEditingFaculty(fac);
    setEditName(fac.name);
    setEditDept(fac.department);
    setEditDesignation(fac.designation || 'Assistant Professor');
    setEditSlots(fac.unavailableSlots || []);
  };

  const handleSaveFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFaculty) return;
    setBusy(true);
    setFeedback(null);
    try {
      await api.updateFaculty(editingFaculty.id, {
        name: editName.trim(),
        department: editDept.trim().toUpperCase(),
        designation: editDesignation.trim(),
        unavailableSlots: editSlots,
      });
      await onRefreshWorkspace();
      setEditingFaculty(null);
      setFeedback({ type: 'success', text: 'Faculty details updated.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update faculty details.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#165B33]">CSBS Faculty</h1>
          <p className="mt-1 text-sm text-[#6B5A4C]">
            Department of CSE (CSBS) teaching staff and course allocations.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start">
          <button
            type="button"
            onClick={() => onNavigate('admin-assignments')}
            className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3.5 py-2 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3]"
          >
            Section Teachers
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
          >
            Add Faculty
          </button>
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

      <div className="relative w-full sm:w-80">
        <Search className="w-4 h-4 text-[#6B5A4C] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search faculty by name or ID"
          className="w-full rounded border border-[#E3D2B4] bg-white pl-9 pr-3 py-2 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
        />
      </div>

      <div className="overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
              <th className="py-3 px-4">Faculty Name</th>
              <th className="py-3 px-4">Staff ID</th>
              <th className="py-3 px-4">Department</th>
              <th className="py-3 px-4">Assigned Courses</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3D2B4] text-sm">
            {facultyList.map((fac) => {
              const assigned = facultyAssignments.filter(
                (fa) => fa.facultyId === fac.id && fa.status === 'Active'
              );

              return (
                <tr key={fac.id} className="hover:bg-[#FAF3E3]/55">
                  <td className="py-3.5 px-4">
                    <div className="font-medium text-[#241710]">{fac.name}</div>
                    <div className="text-xs text-[#6B5A4C]">
                      {fac.designation || 'Faculty'} · {fac.email}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs text-[#241710] whitespace-nowrap">
                    {fac.identifier}
                  </td>
                  <td className="py-3.5 px-4 text-[#241710]">{fac.department}</td>
                  <td className="py-3.5 px-4 text-[#241710]">
                    {assigned.length === 0
                      ? 'None'
                      : assigned
                          .map((a) => `${a.sectionDisplayName} (${a.subjectCode})`)
                          .join(', ')}
                  </td>
                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openEditFaculty(fac)}
                      className="text-xs font-medium text-[#DF6A24] hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#241710]/50 p-4">
          <form
            onSubmit={handleAddFaculty}
            className="w-full max-w-lg rounded-md border border-[#E3D2B4] bg-white p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#E3D2B4] pb-3">
              <h2 className="text-base font-semibold text-[#165B33]">Add Faculty</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-[#6B5A4C] hover:text-[#241710]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Dr. Prakash Kulkarni"
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Staff ID</label>
                <input
                  type="text"
                  required
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  placeholder="e.g. FAC-CSBS-11"
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm font-mono uppercase text-[#241710]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Department</label>
                <input
                  type="text"
                  required
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="faculty@vtu.ac.in"
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Designation
                </label>
                <input
                  type="text"
                  required
                  value={newDesignation}
                  onChange={(e) => setNewDesignation(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Phone (optional)
                </label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Initial Password (optional)
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-4 py-2 text-xs font-medium text-[#241710]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
              >
                {busy ? 'Adding…' : 'Add Faculty'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingFaculty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#241710]/50 p-4">
          <form
            onSubmit={handleSaveFaculty}
            className="w-full max-w-lg rounded-md border border-[#E3D2B4] bg-white p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-[#E3D2B4] pb-3">
              <div>
                <h2 className="text-base font-semibold text-[#165B33]">Edit Faculty</h2>
                <p className="text-xs font-mono text-[#6B5A4C]">{editingFaculty.identifier}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingFaculty(null)}
                className="p-1 text-[#6B5A4C] hover:text-[#241710]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">Department</label>
                <input
                  type="text"
                  required
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                  Designation
                </label>
                <input
                  type="text"
                  required
                  value={editDesignation}
                  onChange={(e) => setEditDesignation(e.target.value)}
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
                />
              </div>
            </div>

            <div className="border-t border-[#E3D2B4] pt-4 space-y-3">
              <div className="text-xs font-semibold text-[#165B33]">Unavailable Hours</div>
              {editSlots.length > 0 && (
                <div className="space-y-1.5">
                  {editSlots.map((slot) => (
                    <div
                      key={slot.id}
                      className="flex items-center justify-between rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3 py-2 text-xs text-[#241710]"
                    >
                      <span>
                        {slot.dayOfWeek || slot.date} · {slot.startTime}–{slot.endTime}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditSlots((prev) => prev.filter((s) => s.id !== slot.id))
                        }
                        className="text-[#B42318] hover:underline ml-2"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <select
                  value={slotDay}
                  onChange={(e) =>
                    setSlotDay(
                      e.target.value as NonNullable<FacultyUnavailabilitySlot['dayOfWeek']>
                    )
                  }
                  className="rounded border border-[#E3D2B4] bg-white px-2.5 py-1.5 text-xs text-[#241710]"
                >
                  {(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const).map(
                    (d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    )
                  )}
                </select>
                <input
                  type="time"
                  value={slotStart}
                  onChange={(e) => setSlotStart(e.target.value)}
                  className="rounded border border-[#E3D2B4] bg-white px-2.5 py-1.5 text-xs text-[#241710]"
                />
                <input
                  type="time"
                  value={slotEnd}
                  onChange={(e) => setSlotEnd(e.target.value)}
                  className="rounded border border-[#E3D2B4] bg-white px-2.5 py-1.5 text-xs text-[#241710]"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={slotReason}
                  onChange={(e) => setSlotReason(e.target.value)}
                  placeholder="Slot label"
                  className="flex-1 rounded border border-[#E3D2B4] bg-white px-2.5 py-1.5 text-xs text-[#241710]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setEditSlots((prev) => [
                      ...prev,
                      {
                        id: `unavail-${Date.now()}`,
                        dayOfWeek: slotDay,
                        startTime: slotStart,
                        endTime: slotEnd,
                        reason: slotReason.trim() || 'Unavailable',
                      },
                    ]);
                  }}
                  className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3 py-1.5 text-xs font-medium text-[#165B33] hover:bg-[#FAF3E3]"
                >
                  Add Slot
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditingFaculty(null)}
                className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-4 py-2 text-xs font-medium text-[#241710]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-[#165B33] px-4 py-2 text-xs font-medium text-white hover:bg-[#104526]"
              >
                {busy ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
