import {
  AcademicSection,
  AppNotification,
  AttendanceAuditLog,
  AttendanceCorrectionRequest,
  AttendanceRecord,
  AttendanceSubmissionAttempt,
  ClassSession,
  ClassSessionType,
  ConflictDetail,
  FacultyAssignment,
  FacultyUnavailabilitySlot,
  InstitutionalPolicy,
  QRAttendanceSession,
  RandomInClassVerification,
  StudentDeviceBinding,
  SubjectItem,
  TimetableEntry,
  UserProfile,
  VerificationClassification,
} from '../shared/types.ts';

const TOKEN_STORAGE_KEY = 'vtu_auth_token_v3';

export class ApiRequestError extends Error {
  public conflicts?: ConflictDetail[];
  public status: number;

  constructor(message: string, status: number, conflicts?: ConflictDetail[]) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.conflicts = conflicts;
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota issues
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(
      data.error || `Request failed with status ${res.status}`,
      res.status,
      Array.isArray(data.conflicts) ? data.conflicts : undefined
    );
  }
  return data as T;
}

export interface BootstrapPayload {
  user: UserProfile;
  policy: InstitutionalPolicy;
  storageMode: 'mongodb' | 'local_sandbox';
  sections: AcademicSection[];
  subjects: SubjectItem[];
  facultyAssignments: FacultyAssignment[];
  classes: ClassSession[];
  records: AttendanceRecord[];
  corrections: AttendanceCorrectionRequest[];
  auditLogs: AttendanceAuditLog[];
  timetable: TimetableEntry[];
  notifications: AppNotification[];
  cohortUsers: UserProfile[];
  facultyDirectory: UserProfile[];
  qrSessions?: QRAttendanceSession[];
  activeQrSessions?: QRAttendanceSession[];
  deviceBinding?: StudentDeviceBinding | null;
  deviceBindings?: StudentDeviceBinding[];
  attendanceAttempts?: AttendanceSubmissionAttempt[];
  pendingRandomChallenges?: RandomInClassVerification[];
}

export interface SessionInfoPayload {
  user: UserProfile | null;
  storageMode: 'mongodb' | 'local_sandbox';
  demoPersonas: UserProfile[];
}

export interface PublicMetaPayload {
  storageMode: 'mongodb' | 'local_sandbox';
  mongoConfigured: boolean;
  sections: AcademicSection[];
  institutionName: string;
  academicYear: string;
}

export interface BulkCsvRowPayload {
  rowNumber: number;
  name: string;
  usn: string;
  email: string;
  department: string;
  section: string;
  semester: number | string;
  academicYear: string;
  rollNumber?: string;
  accountStatus?: string;
}

export interface BulkPreviewResult {
  validRows: Array<{
    rowNumber: number;
    name: string;
    usn: string;
    email: string;
    department: string;
    sectionName: string;
    sectionId: string;
    sectionDisplayName: string;
    programme: string;
    semester: number;
    academicYear: string;
    rollNumber: string;
    accountStatus: 'Active' | 'Inactive';
  }>;
  duplicateRows: Array<{
    rowNumber: number;
    usn: string;
    email: string;
    name: string;
    reason: string;
  }>;
  invalidRows: Array<{
    rowNumber: number;
    usn: string;
    email: string;
    name: string;
    reason: string;
  }>;
}

export interface BulkImportResult {
  importedCount: number;
  skippedDuplicatesCount: number;
  invalidCount: number;
  importedStudents: UserProfile[];
  duplicateRows: BulkPreviewResult['duplicateRows'];
  invalidRows: BulkPreviewResult['invalidRows'];
}

export const api = {
  getPublicMeta(): Promise<PublicMetaPayload> {
    return requestJson<PublicMetaPayload>('/api/meta');
  },

  getSession(): Promise<SessionInfoPayload> {
    return requestJson<SessionInfoPayload>('/api/auth/me');
  },

  async login(identifierOrEmail: string, password: string): Promise<UserProfile> {
    const res = await requestJson<{ user: UserProfile; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifierOrEmail, password }),
    });
    setStoredToken(res.token);
    return res.user;
  },

  async register(payload: {
    name: string;
    identifier: string;
    email: string;
    password: string;
    college: string;
    programme: string;
    semester: number;
    sectionId?: string;
  }): Promise<UserProfile> {
    const res = await requestJson<{ user: UserProfile; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setStoredToken(res.token);
    return res.user;
  },

  async logout(): Promise<void> {
    await requestJson('/api/auth/logout', { method: 'POST' });
    setStoredToken(null);
  },

  getBootstrap(): Promise<BootstrapPayload> {
    return requestJson<BootstrapPayload>('/api/bootstrap');
  },

  // --- Faculty Attendance Marking ---
  submitSessionAttendance(
    sessionId: string,
    payload: {
      topic?: string;
      attendance: Array<{ studentId: string; status: 'Present' | 'Absent' | 'Excused' }>;
    }
  ): Promise<{ session: ClassSession; recordsCreated: number }> {
    return requestJson<{ session: ClassSession; recordsCreated: number }>(
      `/api/faculty/sessions/${sessionId}/attendance`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  recordClassSession(payload: {
    sectionId: string;
    subjectId: string;
    date: string;
    period: string;
    startTime: string;
    endTime: string;
    topic: string;
    classroom: string;
    status: 'Conducted' | 'Cancelled';
    attendance: Array<{ studentId: string; status: 'Present' | 'Absent' | 'Excused' }>;
  }): Promise<{ session: ClassSession; recordsCreated: number }> {
    return requestJson<{ session: ClassSession; recordsCreated: number }>('/api/faculty/classes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // --- Extra Classes, Rescheduling & Substitute Faculty ---
  createExtraClass(payload: {
    sectionId: string;
    subjectId: string;
    sessionType: ClassSessionType;
    date: string;
    period: string;
    startTime: string;
    endTime: string;
    durationHours?: number;
    classroom: string;
    topic: string;
    actualFacultyId?: string;
    originalSessionId?: string;
    markOriginalAs?: 'Rescheduled' | 'Cancelled';
    reason: string;
    notes?: string;
  }): Promise<{ session: ClassSession }> {
    return requestJson<{ session: ClassSession }>('/api/extra-classes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateExtraClass(
    sessionId: string,
    payload: {
      action: 'approve' | 'reject' | 'cancel' | 'update_schedule';
      reason?: string;
      date?: string;
      period?: string;
      startTime?: string;
      endTime?: string;
      classroom?: string;
      actualFacultyId?: string;
      topic?: string;
    }
  ): Promise<{ session: ClassSession }> {
    return requestJson<{ session: ClassSession }>(`/api/extra-classes/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  // --- Admin: Sections ---
  createSection(payload: {
    department: string;
    sectionName: string;
    semester: number;
    academicYear: string;
    programme: string;
    defaultClassroom: string;
  }): Promise<{ section: AcademicSection }> {
    return requestJson<{ section: AcademicSection }>('/api/admin/sections', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateSection(
    sectionId: string,
    updates: Partial<AcademicSection>
  ): Promise<{ section: AcademicSection }> {
    return requestJson<{ section: AcademicSection }>(`/api/admin/sections/${sectionId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  // --- Admin: Students & Bulk CSV ---
  createStudent(payload: {
    name: string;
    identifier: string;
    email: string;
    sectionId: string;
    semester: number;
    academicYear: string;
    rollNumber?: string;
    accountStatus?: 'Active' | 'Inactive' | 'Suspended';
    password?: string;
  }): Promise<{ student: UserProfile }> {
    return requestJson<{ student: UserProfile }>('/api/admin/students', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateStudent(
    studentId: string,
    updates: {
      name?: string;
      email?: string;
      sectionId?: string;
      semester?: number;
      academicYear?: string;
      rollNumber?: string;
      accountStatus?: 'Active' | 'Inactive' | 'Suspended';
      reason?: string;
    }
  ): Promise<{ student: UserProfile }> {
    return requestJson<{ student: UserProfile }>(`/api/admin/students/${studentId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  previewBulkStudents(rows: BulkCsvRowPayload[]): Promise<BulkPreviewResult> {
    return requestJson<BulkPreviewResult>('/api/admin/students/bulk-preview', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
  },

  importBulkStudents(rows: BulkCsvRowPayload[]): Promise<BulkImportResult> {
    return requestJson<BulkImportResult>('/api/admin/students/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
  },

  // --- Admin: Faculty ---
  createFaculty(payload: {
    name: string;
    identifier: string;
    email: string;
    department: string;
    designation: string;
    phone?: string;
    accountStatus?: 'Active' | 'Inactive' | 'Suspended';
    password?: string;
    unavailableSlots?: FacultyUnavailabilitySlot[];
  }): Promise<{ faculty: UserProfile }> {
    return requestJson<{ faculty: UserProfile }>('/api/admin/faculty', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateFaculty(
    facultyId: string,
    updates: {
      name?: string;
      email?: string;
      department?: string;
      designation?: string;
      phone?: string;
      accountStatus?: 'Active' | 'Inactive' | 'Suspended';
      unavailableSlots?: FacultyUnavailabilitySlot[];
    }
  ): Promise<{ faculty: UserProfile }> {
    return requestJson<{ faculty: UserProfile }>(`/api/admin/faculty/${facultyId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  // --- Admin: Subjects ---
  createSubject(payload: Partial<SubjectItem>): Promise<{ subject: SubjectItem }> {
    return requestJson<{ subject: SubjectItem }>('/api/admin/subjects', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateSubjectConfig(
    subjectId: string,
    updates: Partial<SubjectItem>
  ): Promise<{ subject: SubjectItem }> {
    return requestJson<{ subject: SubjectItem }>(`/api/admin/subjects/${subjectId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  // --- Admin: Faculty Assignments ---
  createFacultyAssignment(payload: {
    facultyId: string;
    subjectId: string;
    sectionId: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ assignment: FacultyAssignment }> {
    return requestJson<{ assignment: FacultyAssignment }>('/api/admin/faculty-assignments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateFacultyAssignment(
    assignmentId: string,
    updates: { status?: 'Active' | 'Inactive'; facultyId?: string }
  ): Promise<{ assignment: FacultyAssignment }> {
    return requestJson<{ assignment: FacultyAssignment }>(
      `/api/admin/faculty-assignments/${assignmentId}`,
      {
        method: 'PUT',
        body: JSON.stringify(updates),
      }
    );
  },

  // --- Admin: Timetable ---
  createTimetableEntry(payload: {
    facultyAssignmentId: string;
    dayOfWeek: TimetableEntry['dayOfWeek'];
    period: string;
    startTime: string;
    endTime: string;
    classroom: string;
    batch?: 'B1' | 'B2' | 'All';
    upcomingDate?: string;
  }): Promise<{ entry: TimetableEntry; scheduledSession: ClassSession }> {
    return requestJson<{ entry: TimetableEntry; scheduledSession: ClassSession }>(
      '/api/admin/timetable',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  updateTimetableEntry(
    entryId: string,
    updates: Partial<TimetableEntry>
  ): Promise<{ entry: TimetableEntry }> {
    return requestJson<{ entry: TimetableEntry }>(`/api/admin/timetable/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  deleteTimetableEntry(entryId: string): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>(`/api/admin/timetable/${entryId}`, {
      method: 'DELETE',
    });
  },

  // --- Corrections & Policy ---
  submitCorrection(formData: FormData): Promise<{ request: AttendanceCorrectionRequest }> {
    return requestJson<{ request: AttendanceCorrectionRequest }>('/api/corrections', {
      method: 'POST',
      body: formData,
    });
  },

  resubmitCorrection(
    requestId: string,
    formData: FormData
  ): Promise<{ request: AttendanceCorrectionRequest }> {
    return requestJson<{ request: AttendanceCorrectionRequest }>(
      `/api/corrections/${requestId}/resubmit`,
      {
        method: 'POST',
        body: formData,
      }
    );
  },

  withdrawCorrection(requestId: string): Promise<{ request: AttendanceCorrectionRequest }> {
    return requestJson<{ request: AttendanceCorrectionRequest }>(
      `/api/corrections/${requestId}/withdraw`,
      { method: 'POST' }
    );
  },

  reviewCorrection(
    requestId: string,
    decision: 'Under Review' | 'Additional Evidence Requested' | 'Approved' | 'Rejected',
    decisionReason: string
  ): Promise<{ request: AttendanceCorrectionRequest }> {
    return requestJson<{ request: AttendanceCorrectionRequest }>(
      `/api/corrections/${requestId}/review`,
      {
        method: 'POST',
        body: JSON.stringify({ decision, decisionReason }),
      }
    );
  },

  async fetchEvidenceBlobUrl(
    requestId: string,
    fileId: string
  ): Promise<{ blobUrl: string; mimeType: string }> {
    const token = getStoredToken();
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const res = await fetch(`/api/evidence/${requestId}/${fileId}`, {
      headers,
      credentials: 'include',
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || 'Unable to access private evidence document.');
    }
    const blob = await res.blob();
    return {
      blobUrl: URL.createObjectURL(blob),
      mimeType: blob.type || 'application/pdf',
    };
  },

  updatePolicy(updates: Partial<InstitutionalPolicy>): Promise<{ policy: InstitutionalPolicy }> {
    return requestJson<{ policy: InstitutionalPolicy }>('/api/admin/policy', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  markNotificationsRead(notificationId?: string): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>('/api/notifications/mark-read', {
      method: 'POST',
      body: JSON.stringify({ notificationId }),
    });
  },

  resetDemoData(): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>('/api/demo/reset', { method: 'POST' });
  },

  // --- Dynamic QR Attendance & Geofencing ---

  createQrSession(params: {
    sectionId: string;
    subjectId: string;
    durationMinutes?: number;
    classroom?: string;
    hostLatitude?: number;
    hostLongitude?: number;
    hostAccuracy?: number;
  }): Promise<{ session: QRAttendanceSession }> {
    return requestJson<{ session: QRAttendanceSession }>('/api/qr-sessions', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  listQrSessions(): Promise<{ sessions: QRAttendanceSession[] }> {
    return requestJson<{ sessions: QRAttendanceSession[] }>('/api/qr-sessions');
  },

  getQrSession(
    id: string
  ): Promise<{
    session: QRAttendanceSession;
    attempts: AttendanceSubmissionAttempt[];
    verifications: RandomInClassVerification[];
  }> {
    return requestJson<{
      session: QRAttendanceSession;
      attempts: AttendanceSubmissionAttempt[];
      verifications: RandomInClassVerification[];
    }>(`/api/qr-sessions/${id}`);
  },

  refreshQrToken(
    sessionId: string
  ): Promise<{
    token: string;
    tokenExpiresAt: number;
    tokenIssuedAt: number;
    refreshCount: number;
  }> {
    return requestJson<{
      token: string;
      tokenExpiresAt: number;
      tokenIssuedAt: number;
      refreshCount: number;
    }>(`/api/qr-sessions/${sessionId}/refresh-token`, {
      method: 'POST',
    });
  },

  closeQrSession(sessionId: string): Promise<{ session: QRAttendanceSession }> {
    return requestJson<{ session: QRAttendanceSession }>(`/api/qr-sessions/${sessionId}/close`, {
      method: 'POST',
    });
  },

  submitQrScan(params: {
    sessionId: string;
    qrToken: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    deviceFingerprint: string;
    devicePlatform: string;
    browserName: string;
  }): Promise<{
    success: boolean;
    classification: VerificationClassification;
    message: string;
    attempt: AttendanceSubmissionAttempt;
    record?: AttendanceRecord;
  }> {
    return requestJson<{
      success: boolean;
      classification: VerificationClassification;
      message: string;
      attempt: AttendanceSubmissionAttempt;
      record?: AttendanceRecord;
    }>('/api/qr-attendance/scan', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  triggerRandomVerification(
    sessionId: string,
    count?: number
  ): Promise<{ verifications: RandomInClassVerification[] }> {
    return requestJson<{ verifications: RandomInClassVerification[] }>(
      `/api/qr-sessions/${sessionId}/random-verify`,
      {
        method: 'POST',
        body: JSON.stringify({ count }),
      }
    );
  },

  respondRandomVerification(
    challengeId: string,
    code: string
  ): Promise<{ success: boolean; message: string }> {
    return requestJson<{ success: boolean; message: string }>('/api/random-verify/respond', {
      method: 'POST',
      body: JSON.stringify({ challengeId, code }),
    });
  },

  getMyDeviceBinding(): Promise<{ binding: StudentDeviceBinding | null }> {
    return requestJson<{ binding: StudentDeviceBinding | null }>('/api/device-binding/my');
  },

  requestDeviceChange(params: {
    reason: string;
    newFingerprint: string;
    devicePlatform?: string;
    browserName?: string;
  }): Promise<{ binding: StudentDeviceBinding; message: string }> {
    return requestJson<{ binding: StudentDeviceBinding; message: string }>(
      '/api/device-binding/request-change',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
  },

  getAdminQrMonitoring(): Promise<{
    policy: InstitutionalPolicy;
    activeSessions: QRAttendanceSession[];
    recentSessions: QRAttendanceSession[];
    attempts: AttendanceSubmissionAttempt[];
    deviceBindings: StudentDeviceBinding[];
  }> {
    return requestJson<{
      policy: InstitutionalPolicy;
      activeSessions: QRAttendanceSession[];
      recentSessions: QRAttendanceSession[];
      attempts: AttendanceSubmissionAttempt[];
      deviceBindings: StudentDeviceBinding[];
    }>('/api/admin/qr-monitoring');
  },

  reviewDeviceBinding(
    id: string,
    status: 'Approved' | 'Rejected',
    reviewNotes?: string
  ): Promise<{ binding: StudentDeviceBinding }> {
    return requestJson<{ binding: StudentDeviceBinding }>(
      `/api/admin/device-bindings/${id}/review`,
      {
        method: 'POST',
        body: JSON.stringify({ status, reviewNotes }),
      }
    );
  },

  resetDeviceBinding(studentId: string): Promise<{ ok: boolean; message: string }> {
    return requestJson<{ ok: boolean; message: string }>(
      `/api/admin/device-bindings/${studentId}/reset`,
      {
        method: 'POST',
      }
    );
  },

  updateCampusLocationPolicy(params: {
    campusLatitude?: number;
    campusLongitude?: number;
    permittedRadiusMeters?: number;
    teacherHostRadiusMeters?: number;
    maxAcceptableGpsAccuracyMeters?: number;
    qrRefreshSeconds?: number;
    defaultSessionDurationMinutes?: number;
    randomVerificationWindowMinutes?: number;
    enforceDeviceRegistration?: boolean;
  }): Promise<{ policy: InstitutionalPolicy; message: string }> {
    return requestJson<{ policy: InstitutionalPolicy; message: string }>(
      '/api/admin/policy/location',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
  },
};
