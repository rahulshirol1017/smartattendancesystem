import {
  AcademicSection,
  AppNotification,
  AttendanceAuditLog,
  AttendanceCorrectionRequest,
  AttendanceRecord,
  AttendanceSubmissionAttempt,
  CentralizedAttendanceRosterItem,
  CentralizedAttendanceSummary,
  ClassSession,
  ClassSessionType,
  ConflictDetail,
  FacultyAssignment,
  FacultyUnavailabilitySlot,
  InstitutionalPolicy,
  QRAttendanceSession,
  RandomInClassVerification,
  RecordSource,
  StudentDeviceBinding,
  SubjectItem,
  TimetableEntry,
  UserProfile,
  VerificationClassification,
  EnrolledSubjectRecord,
  FaceQualityMetrics,
  LivenessChallengeType,
  ModelCalibrationReport,
  ModelVersionRecord,
  TrainingJobStatus,
  VerificationEvidenceFrames,
  VerificationRequestPayload,
  VerificationResult,
  VerificationSessionDescriptor,
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

async function requestJson<T>(url: string, options: RequestInit = {}, retries = 3): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    // Auto-retry on Render Free Tier cold-boot gateway responses (502/503/504)
    if ((res.status === 502 || res.status === 503 || res.status === 504) && retries > 0) {
      console.warn(`[API] Received HTTP ${res.status} from ${url}. Cloud instance waking up. Retrying in 2s (${retries} attempts left)...`);
      await new Promise((r) => setTimeout(r, 2000));
      return requestJson<T>(url, options, retries - 1);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiRequestError(
        data.error || (res.status === 502 ? 'The cloud server was waking up from standby. Please click Try again.' : `Request failed with status ${res.status}`),
        res.status,
        Array.isArray(data.conflicts) ? data.conflicts : undefined
      );
    }
    return data as T;
  } catch (err) {
    if (retries > 0 && err instanceof TypeError) {
      // Network hiccup during container transition
      await new Promise((r) => setTimeout(r, 2000));
      return requestJson<T>(url, options, retries - 1);
    }
    throw err;
  }
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
    return requestJson<{ user: UserProfile | null }>('/api/auth/me')
      .then((data) => ({
        user: data.user || null,
        storageMode: 'mongodb' as const,
        demoPersonas: [] as UserProfile[],
      }))
      .catch((err) => {
        if (err instanceof ApiRequestError && err.status === 401) {
          setStoredToken(null);
          return {
            user: null,
            storageMode: 'mongodb' as const,
            demoPersonas: [] as UserProfile[],
          };
        }
        throw err;
      });
  },

  async login(loginInput: string, password: string): Promise<UserProfile> {
    const isEmail = loginInput.includes('@');
    const bodyPayload = isEmail
      ? { email: loginInput.trim().toLowerCase(), password }
      : { identifier: loginInput.trim(), password };
    const res = await requestJson<{ user: UserProfile; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(bodyPayload),
    });
    setStoredToken(res.token);
    return res.user;
  },

  async sendRegistrationOtp(payload: {
    name: string;
    identifier: string;
    email: string;
    password: string;
    confirmPassword?: string;
    college?: string;
    department?: string;
    programme?: string;
    semester?: number;
    sectionId?: string;
  }): Promise<{ success: boolean; message: string; email: string; identifier: string }> {
    return requestJson<{ success: boolean; message: string; email: string; identifier: string }>(
      '/api/auth/register-send-otp',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  async verifyRegistrationOtp(payload: {
    identifier: string;
    email?: string;
    code: string;
  }): Promise<{ user: UserProfile; token: string; message: string; facialEnrolled: boolean }> {
    const res = await requestJson<{
      user: UserProfile;
      token: string;
      message: string;
      facialEnrolled: boolean;
    }>('/api/auth/register-verify-otp', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setStoredToken(res.token);
    return res;
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

  async forgotPassword(
    identifierOrEmail: string
  ): Promise<{ success: boolean; message: string; email?: string; identifier?: string }> {
    const isEmail = identifierOrEmail.includes('@');
    const body = isEmail ? { email: identifierOrEmail.trim() } : { identifier: identifierOrEmail.trim() };
    return requestJson<{ success: boolean; message: string; email?: string; identifier?: string }>(
      '/api/auth/forgot-password',
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  },

  async verifyResetCode(
    identifierOrEmail: string,
    code: string
  ): Promise<{ success: boolean; message: string }> {
    const isEmail = identifierOrEmail.includes('@');
    const body = isEmail
      ? { email: identifierOrEmail.trim(), code }
      : { identifier: identifierOrEmail.trim(), code };
    return requestJson<{ success: boolean; message: string }>('/api/auth/verify-reset-code', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async resetPassword(payload: {
    identifierOrEmail?: string;
    email?: string;
    identifier?: string;
    code: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    const rawInput = payload.identifierOrEmail || payload.email || payload.identifier || '';
    const isEmail = rawInput.includes('@');
    const body = {
      ...(isEmail ? { email: rawInput.trim() } : { identifier: rawInput.trim() }),
      code: payload.code,
      newPassword: payload.newPassword,
      confirmPassword: payload.confirmPassword,
    };
    return requestJson<{ success: boolean; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(body),
    });
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

  // Centralized Attendance: Unified roster & summary
  getClassAttendance(classId: string): Promise<{
    classSession: ClassSession;
    qrSession?: QRAttendanceSession | null;
    roster: CentralizedAttendanceRosterItem[];
    summary: CentralizedAttendanceSummary;
  }> {
    return requestJson<{
      classSession: ClassSession;
      qrSession?: QRAttendanceSession | null;
      roster: CentralizedAttendanceRosterItem[];
      summary: CentralizedAttendanceSummary;
    }>(`/api/attendance/class/${classId}`);
  },

  // Centralized Attendance: Manually update/toggle a single student record
  updateSingleAttendance(payload: {
    classId: string;
    studentId: string;
    status: 'Present' | 'Absent' | 'Excused';
    reason?: string;
  }): Promise<{
    success: boolean;
    record: AttendanceRecord;
    actionTaken: string;
    conflictDetected?: boolean;
    conflictReason?: string;
    summary: CentralizedAttendanceSummary;
    roster: CentralizedAttendanceRosterItem[];
  }> {
    return requestJson<{
      success: boolean;
      record: AttendanceRecord;
      actionTaken: string;
      conflictDetected?: boolean;
      conflictReason?: string;
      summary: CentralizedAttendanceSummary;
      roster: CentralizedAttendanceRosterItem[];
    }>('/api/attendance/update-single', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Centralized Attendance: Finalize class attendance (mark unrecorded pending as Absent)
  finalizeClassAttendance(payload: {
    classId: string;
    reason?: string;
  }): Promise<{
    success: boolean;
    finalizedCount: number;
    summary: CentralizedAttendanceSummary;
    roster: CentralizedAttendanceRosterItem[];
    classSession: ClassSession;
  }> {
    return requestJson<{
      success: boolean;
      finalizedCount: number;
      summary: CentralizedAttendanceSummary;
      roster: CentralizedAttendanceRosterItem[];
      classSession: ClassSession;
    }>('/api/attendance/finalize-class', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
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
  getUsers(filter?: { role?: string }): Promise<{ users: UserProfile[] }> {
    return this.getBootstrap().then((data) => {
      let users = data.cohortUsers || [];
      if (filter?.role) {
        users = users.filter((u) => u.role === filter.role);
      }
      return { users };
    });
  },

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
    classId?: string;
    sectionId?: string;
    subjectId?: string;
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

  // --------------------------------------------------------------------------
  // QR + FACIAL RECOGNITION & ATTENDANCE
  // --------------------------------------------------------------------------

  validatePublicQrScan(params: {
    sessionId: string;
    qrToken: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    deviceFingerprint?: string;
    devicePlatform?: string;
    browserName?: string;
  }): Promise<{
    success: boolean;
    qrValidated: boolean;
    verificationSessionId: string;
    sessionToken: string;
    challengeType: LivenessChallengeType;
    challengeInstruction: string;
    sessionInfo: {
      id: string;
      subjectCode: string;
      subjectName: string;
      sectionDisplayName: string;
      facultyName: string;
      classroom?: string;
    };
    message?: string;
  }> {
    return requestJson('/api/qr-attendance/validate-scan-public', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  validateQrScanBeforeFace(params: {
    sessionId: string;
    qrToken: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
    deviceFingerprint?: string;
    devicePlatform?: string;
    browserName?: string;
  }): Promise<{
    success: boolean;
    classification?: VerificationClassification;
    message?: string;
    qrValidated?: boolean;
    gpsValidated?: boolean;
    distanceMeters?: number;
    verificationSessionId?: string;
    sessionToken?: string;
    challengeType?: LivenessChallengeType;
    challengeInstruction?: string;
    studentId?: string;
    studentName?: string;
    enrolled?: boolean;
    referenceEmbeddings?: number[][];
  }> {
    return requestJson('/api/qr-attendance/validate-scan', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  finalizeFaceAttendance(
    params: {
      verificationSessionId: string;
      sessionToken: string;
      qrSessionId: string;
      evidenceFrames: VerificationEvidenceFrames;
    },
    apiBaseUrl = ''
  ): Promise<{
    success: boolean;
    classification: VerificationClassification;
    message: string;
    record?: AttendanceRecord;
    attempt?: AttendanceSubmissionAttempt;
    verificationResult: VerificationResult;
    latencyMetrics?: {
      detectionMs: number;
      embeddingMs: number;
      verificationMs: number;
      totalMs: number;
    };
  }> {
    return requestJson(`${apiBaseUrl}/api/qr-attendance/finalize-face-attendance`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  changePassword(params: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    return requestJson('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  identifyLiveFace(params: {
    verificationSessionId: string;
    sessionToken: string;
    liveFrameJpeg: string;
  }): Promise<{
    matched: boolean;
    isProxy?: boolean;
    status?: string;
    matchedUsn?: string;
    expectedUsn?: string;
    studentName?: string;
    similarity?: number;
    message: string;
  }> {
    return requestJson('/api/verification/identify-live-face', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  // --------------------------------------------------------------------------
  // ADMIN FACIAL MODEL TRAINING PLATFORM
  // --------------------------------------------------------------------------

  getFacialSubjects(): Promise<{ count: number; subjects: EnrolledSubjectRecord[] }> {
    return requestJson<{ count: number; subjects: EnrolledSubjectRecord[] }>(
      '/api/admin/facial/subjects'
    );
  },

  enrollFacialSubject(data: {
    subjectId: string;
    displayName?: string;
    imagesBase64?: string[];
    embeddings?: number[][];
    sampleLabels?: Array<{ angleLabel?: string; lightingLabel?: string; qualityScore?: number }>;
    consentConfirmed: boolean;
    mode?: 'append' | 'replace';
    modelVersion?: string;
  }): Promise<{ subject: EnrolledSubjectRecord }> {
    return requestJson<{ subject: EnrolledSubjectRecord }>('/api/admin/facial/enroll', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateFacialSubject(
    subjectId: string,
    data: {
      displayName?: string;
      imagesBase64?: string[];
      sampleLabels?: Array<{ angleLabel?: string; lightingLabel?: string; qualityScore?: number }>;
      consentConfirmed: boolean;
      mode?: 'append' | 'replace';
    }
  ): Promise<{ subject: EnrolledSubjectRecord }> {
    return requestJson<{ subject: EnrolledSubjectRecord }>(
      `/api/admin/facial/subjects/${encodeURIComponent(subjectId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
  },

  deleteFacialSubject(subjectId: string): Promise<{ deleted: boolean; subjectId: string }> {
    return requestJson<{ deleted: boolean; subjectId: string }>(
      `/api/admin/facial/subjects/${encodeURIComponent(subjectId)}`,
      {
        method: 'DELETE',
      }
    );
  },

  testFaceImageQuality(imageBase64: string, angleLabel?: string): Promise<FaceQualityMetrics> {
    return requestJson<FaceQualityMetrics>('/api/admin/facial/test-quality', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, angleLabel }),
    });
  },

  prepareDataset(options?: {
    seed?: number;
    minImagesPerPerson?: number;
  }): Promise<{ ok: boolean; message: string; summary?: Record<string, unknown> }> {
    return requestJson('/api/admin/facial/prepare-dataset', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  },

  startModelTraining(options?: {
    epochs?: number;
    batchSize?: number;
    learningRate?: number;
    seed?: number;
  }): Promise<{ ok: boolean; message: string }> {
    return requestJson('/api/admin/facial/train', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  },

  getModelTrainingStatus(): Promise<TrainingJobStatus> {
    return requestJson<TrainingJobStatus>('/api/admin/facial/train/status');
  },

  stopModelTraining(): Promise<{ ok: boolean; message: string }> {
    return requestJson('/api/admin/facial/train/stop', {
      method: 'POST',
    });
  },

  evaluateModel(params?: {
    onnxPath?: string;
    testDir?: string;
  }): Promise<{ ok: boolean; report?: ModelCalibrationReport; message?: string }> {
    return requestJson('/api/admin/facial/evaluate', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  },

  getModelRegistry(): Promise<{
    activeVersionId: string;
    previousActiveVersionId: string | null;
    versions: ModelVersionRecord[];
    lastUpdated: string;
  }> {
    return requestJson('/api/admin/facial/models');
  },

  deployModel(versionId: string): Promise<{
    ok: boolean;
    message: string;
    activeVersion?: ModelVersionRecord;
  }> {
    return requestJson('/api/admin/facial/models/deploy', {
      method: 'POST',
      body: JSON.stringify({ versionId }),
    });
  },

  rollbackModel(): Promise<{
    ok: boolean;
    message: string;
    activeVersion?: ModelVersionRecord;
  }> {
    return requestJson('/api/admin/facial/models/rollback', {
      method: 'POST',
    });
  },

  getCachedCalibrationReport(): Promise<ModelCalibrationReport | null> {
    return requestJson<ModelCalibrationReport | null>('/api/admin/facial/report');
  },
};

export const verificationApi = {
  async createSession(
    params: {
      studentId?: string;
      qrSessionId?: string;
      verificationSessionId?: string;
      parentAssertionToken?: string;
      parentAuthKey?: string;
    },
    apiBaseUrl = ''
  ): Promise<VerificationSessionDescriptor> {
    const data = await requestJson<{ session: VerificationSessionDescriptor }>(
      `${apiBaseUrl}/api/verification/session`,
      {
        method: 'POST',
        body: JSON.stringify({
          studentId: params.studentId,
          qrSessionId: params.qrSessionId,
          verificationSessionId: params.verificationSessionId,
          parentAssertionToken: params.parentAssertionToken,
        }),
        headers: params.parentAuthKey ? { Authorization: `Bearer ${params.parentAuthKey}` } : {},
      }
    );
    return data.session;
  },

  async verifyFace(
    payload: VerificationRequestPayload,
    apiBaseUrl = ''
  ): Promise<VerificationResult> {
    const data = await requestJson<{ result: VerificationResult }>(
      `${apiBaseUrl}/api/verification/verify`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return data.result;
  },

  async identifyFace(
    params: {
      verificationSessionId: string;
      sessionToken: string;
      liveFrameJpeg: string;
    },
    apiBaseUrl = ''
  ): Promise<{
    matched: boolean;
    isProxy?: boolean;
    status?: string;
    matchedUsn?: string;
    expectedUsn?: string;
    studentName?: string;
    similarity?: number;
    message: string;
  }> {
    return requestJson(`${apiBaseUrl}/api/verification/identify-live-face`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async verifyResultSignature(
    result: VerificationResult,
    apiBaseUrl = ''
  ): Promise<boolean> {
    const data = await requestJson<{ valid: boolean }>(
      `${apiBaseUrl}/api/verification/verify-signature`,
      {
        method: 'POST',
        body: JSON.stringify({ result }),
      }
    );
    return data.valid;
  },
};

