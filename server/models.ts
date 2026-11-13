import mongoose, { Schema } from 'mongoose';

const AcademicSectionSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    department: { type: String, required: true, index: true },
    sectionName: { type: String, required: true },
    displayName: { type: String, required: true },
    semester: { type: Number, required: true, index: true },
    academicYear: { type: String, required: true },
    programme: { type: String, required: true },
    defaultClassroom: { type: String, default: 'LH-101' },
    status: { type: String, enum: ['Active', 'Archived'], default: 'Active', index: true },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);
AcademicSectionSchema.index(
  { department: 1, sectionName: 1, semester: 1, academicYear: 1 },
  { unique: true }
);

const UserSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    identifier: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['student', 'faculty', 'admin'], required: true, index: true },
    college: { type: String, required: true },
    department: { type: String, required: true, index: true },
    programme: { type: String, required: true },
    semester: { type: Number, required: true, index: true },
    section: { type: String, default: 'A' },
    sectionId: { type: String, index: true },
    sectionDisplayName: { type: String },
    academicYear: { type: String, default: '2026–2027' },
    rollNumber: { type: String },
    designation: { type: String },
    phone: { type: String },
    unavailableSlots: [
      {
        id: String,
        date: String,
        dayOfWeek: String,
        startTime: String,
        endTime: String,
        reason: String,
      },
    ],
    accountStatus: {
      type: String,
      enum: ['Active', 'Inactive', 'Suspended'],
      default: 'Active',
      index: true,
    },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

const SubjectSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    code: { type: String, required: true, index: true },
    name: { type: String, required: true },
    department: { type: String, required: true, index: true },
    semester: { type: Number, required: true, index: true },
    programme: { type: String, required: true },
    credits: { type: Number, default: 4 },
    attendanceRequirement: { type: Number, required: true },
    assignedFacultyId: { type: String, required: true, index: true },
    assignedFacultyName: { type: String, required: true },
    academicYear: { type: String, required: true },
    estimatedRemainingClasses: { type: Number, default: 15 },
    status: { type: String, enum: ['Active', 'Archived'], default: 'Active' },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const FacultyAssignmentSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    facultyId: { type: String, required: true, index: true },
    facultyName: { type: String, required: true },
    subjectId: { type: String, required: true, index: true },
    subjectCode: { type: String, required: true },
    subjectName: { type: String, required: true },
    sectionId: { type: String, required: true, index: true },
    sectionDisplayName: { type: String, required: true },
    department: { type: String, required: true },
    semester: { type: Number, required: true },
    academicYear: { type: String, required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);
FacultyAssignmentSchema.index({ facultyId: 1, sectionId: 1, subjectId: 1 });

const ClassSessionSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    sectionId: { type: String, required: true, index: true },
    sectionDisplayName: { type: String, required: true },
    subjectId: { type: String, required: true, index: true },
    subjectCode: { type: String },
    subjectName: { type: String },
    timetableEntryId: { type: String, index: true },
    originalSessionId: { type: String },
    replacementSessionId: { type: String },
    date: { type: String, required: true, index: true },
    period: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    durationHours: { type: Number, default: 1 },
    topic: { type: String, required: true },
    sessionType: {
      type: String,
      enum: ['Regular', 'Extra', 'Replacement', 'Swapped'],
      default: 'Regular',
      index: true,
    },
    status: {
      type: String,
      enum: ['Scheduled', 'Confirmed', 'Conducted', 'Cancelled', 'Rescheduled'],
      default: 'Conducted',
      index: true,
    },
    scheduledFacultyId: { type: String, required: true, index: true },
    scheduledFacultyName: { type: String, required: true },
    facultyId: { type: String, required: true, index: true },
    facultyName: { type: String, required: true },
    isSubstitute: { type: Boolean, default: false },
    classroom: { type: String, required: true },
    batch: { type: String, enum: ['B1', 'B2', 'All'], default: 'All' },
    attendanceSubmitted: { type: Boolean, default: false },
    cancellationReason: { type: String },
    rescheduleReason: { type: String },
    extraClassReason: { type: String },
    notes: { type: String },
    approvalStatus: {
      type: String,
      enum: ['Approved', 'Pending Approval', 'Rejected'],
      default: 'Approved',
    },
    createdBy: { type: String },
    updatedBy: { type: String },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);
ClassSessionSchema.index({ sectionId: 1, subjectId: 1, date: -1 });

const AttendanceRecordSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    studentId: { type: String, required: true, index: true },
    classId: { type: String, required: true, index: true },
    sectionId: { type: String, required: true, index: true },
    subjectId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['Present', 'Absent', 'Excused', 'Corrected'],
      required: true,
    },
    effectivePresent: { type: Boolean, default: true },
    originalStatus: {
      type: String,
      enum: ['Present', 'Absent', 'Excused', 'Corrected'],
      required: true,
    },
    recordSource: {
      type: String,
      enum: ['Faculty Register', 'Biometric Terminal', 'LMS Sync', 'Approved Correction', 'QR Geoverified'],
      default: 'Faculty Register',
    },
    recordedById: { type: String, required: true },
    recordedByName: { type: String, required: true },
    timestamp: { type: String, required: true },
    correctionVersion: { type: Number, default: 0 },
    pendingRequestId: { type: String },
  },
  { timestamps: true }
);
AttendanceRecordSchema.index({ studentId: 1, classId: 1 }, { unique: true });
AttendanceRecordSchema.index({ studentId: 1, subjectId: 1 });
AttendanceRecordSchema.index({ sectionId: 1, subjectId: 1 });

const CorrectionRequestSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    referenceNumber: { type: String, required: true, unique: true, index: true },
    studentId: { type: String, required: true, index: true },
    studentName: { type: String, required: true },
    studentIdentifier: { type: String, required: true },
    sectionId: { type: String, required: true, index: true },
    sectionDisplayName: { type: String, required: true },
    attendanceRecordId: { type: String, required: true, index: true },
    subjectId: { type: String, required: true, index: true },
    subjectCode: { type: String, required: true },
    subjectName: { type: String, required: true },
    classId: { type: String, required: true },
    classDate: { type: String, required: true },
    classPeriod: { type: String, required: true },
    classTopic: { type: String, required: true },
    originalStatus: { type: String, required: true },
    requestedStatus: { type: String, enum: ['Present', 'Excused'], required: true },
    reason: { type: String, required: true },
    supportingNotes: { type: String, default: '' },
    evidenceFiles: [
      {
        id: String,
        originalName: String,
        storedName: String,
        mimeType: String,
        sizeBytes: Number,
        documentCategory: String,
        uploadedAt: String,
      },
    ],
    evidenceAccessLogs: [
      {
        viewerId: String,
        viewerName: String,
        viewerRole: String,
        fileName: String,
        accessedAt: String,
      },
    ],
    workflowStatus: {
      type: String,
      enum: [
        'Draft',
        'Submitted',
        'Under Review',
        'Additional Evidence Requested',
        'Approved',
        'Rejected',
        'Withdrawn',
      ],
      required: true,
      index: true,
    },
    reviewerId: { type: String },
    reviewerName: { type: String },
    decisionReason: { type: String },
    appealCount: { type: Number, default: 0 },
    timeline: [
      {
        status: String,
        actorName: String,
        actorRole: String,
        note: String,
        timestamp: String,
      },
    ],
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { timestamps: false }
);
CorrectionRequestSchema.index({ sectionId: 1, subjectId: 1, workflowStatus: 1 });

const AuditLogSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    category: { type: String, default: 'CORRECTION_WORKFLOW', index: true },
    attendanceRecordId: { type: String, required: true, index: true },
    sectionId: { type: String, index: true },
    sectionDisplayName: { type: String },
    subjectId: { type: String, required: true, index: true },
    subjectCode: { type: String, required: true },
    subjectName: { type: String, required: true },
    classId: { type: String, required: true },
    classDate: { type: String, required: true },
    classPeriod: { type: String, required: true },
    studentId: { type: String, required: true, index: true },
    studentName: { type: String, required: true },
    studentIdentifier: { type: String, required: true },
    previousValue: { type: String, required: true },
    newValue: { type: String, required: true },
    previousVersion: { type: Number, required: true },
    newVersion: { type: Number, required: true },
    action: { type: String, required: true },
    actorId: { type: String, required: true },
    actorName: { type: String, required: true },
    actorRole: { type: String, required: true },
    correctionRequestId: { type: String },
    correctionReferenceNumber: { type: String },
    reason: { type: String, required: true },
    evidenceReference: { type: String, default: '' },
    timestamp: { type: String, required: true, index: true },
  },
  { timestamps: false }
);

const TimetableEntrySchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    sectionId: { type: String, required: true, index: true },
    sectionDisplayName: { type: String, required: true },
    subjectId: { type: String, required: true, index: true },
    subjectCode: { type: String, required: true },
    subjectName: { type: String, required: true },
    facultyAssignmentId: { type: String, required: true, index: true },
    facultyId: { type: String, required: true, index: true },
    facultyName: { type: String, required: true },
    dayOfWeek: { type: String, required: true, index: true },
    period: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    classroom: { type: String, required: true },
    batch: { type: String, enum: ['B1', 'B2', 'All'], default: 'All' },
    validityPeriod: { type: String, required: true },
    upcomingDate: { type: String, required: true },
    upcomingStatus: {
      type: String,
      enum: ['Scheduled', 'Confirmed', 'Conducted', 'Cancelled', 'Rescheduled'],
      default: 'Scheduled',
    },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);
TimetableEntrySchema.index({ sectionId: 1, dayOfWeek: 1 });

const NotificationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    recipientId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    relatedRecordId: { type: String },
    targetNav: { type: String },
    read: { type: Boolean, default: false, index: true },
    timestamp: { type: String, required: true },
  },
  { timestamps: false }
);

const PolicySchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    institutionName: { type: String, required: true },
    academicYear: { type: String, required: true },
    semester: { type: Number, required: true },
    programme: { type: String, required: true },
    defaultMinimumPercentage: { type: Number, required: true },
    warningBufferPercentage: { type: Number, required: true },
    calculationMethod: { type: String, required: true },
    cancelledClassPolicy: { type: String, required: true },
    excusedAbsencePolicy: { type: String, required: true },
    approvalPermissions: [{ type: String }],
    evidenceRequiredForSubmission: { type: Boolean, default: false },
    maxEvidenceSizeMB: { type: Number, default: 5 },
    allowedEvidenceTypes: [{ type: String }],
    allowAppeals: { type: Boolean, default: true },
    appealWindowDays: { type: Number, default: 14 },
    allowFacultyExtraClassRequests: { type: Boolean, default: true },
    enforceRoomConflictCheck: { type: Boolean, default: true },
    campusLatitude: { type: Number, default: 15.8858 },
    campusLongitude: { type: Number, default: 74.5298 },
    permittedRadiusMeters: { type: Number, default: 350 },
    teacherHostRadiusMeters: { type: Number, default: 50 },
    maxAcceptableGpsAccuracyMeters: { type: Number, default: 80 },
    qrRefreshSeconds: { type: Number, default: 5 },
    defaultSessionDurationMinutes: { type: Number, default: 5 },
    randomVerificationWindowMinutes: { type: Number, default: 3 },
    enforceDeviceRegistration: { type: Boolean, default: false },
    policyLastVerifiedNote: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { timestamps: false }
);

const QRAttendanceSessionSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    classId: { type: String, index: true },
    sectionId: { type: String, required: true, index: true },
    sectionDisplayName: { type: String, required: true },
    subjectId: { type: String, required: true, index: true },
    subjectCode: { type: String, required: true },
    subjectName: { type: String, required: true },
    facultyId: { type: String, required: true, index: true },
    facultyName: { type: String, required: true },
    classroom: { type: String, required: true },
    hostLatitude: { type: Number },
    hostLongitude: { type: Number },
    hostAccuracy: { type: Number },
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    currentQrToken: { type: String, required: true },
    tokenExpiresAt: { type: Number, required: true },
    tokenIssuedAt: { type: Number, required: true },
    sessionExpiresAt: { type: Number, required: true },
    durationMinutes: { type: Number, default: 5 },
    status: { type: String, enum: ['ACTIVE', 'CLOSED'], default: 'ACTIVE', index: true },
    refreshCount: { type: Number, default: 0 },
    totalEnrolled: { type: Number, default: 0 },
    verifiedCount: { type: Number, default: 0 },
    reviewRequiredCount: { type: Number, default: 0 },
    rejectedCount: { type: Number, default: 0 },
    createdAt: { type: String, required: true },
    closedAt: { type: String },
  },
  { timestamps: true }
);

const StudentDeviceBindingSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    studentId: { type: String, required: true, unique: true, index: true },
    studentName: { type: String, required: true },
    studentIdentifier: { type: String, required: true, index: true },
    sectionDisplayName: { type: String },
    deviceFingerprint: { type: String, required: true, index: true },
    devicePlatform: { type: String, required: true },
    browserName: { type: String, required: true },
    status: {
      type: String,
      enum: ['Approved', 'Pending_Approval', 'Rejected'],
      default: 'Approved',
      index: true,
    },
    registeredAt: { type: String, required: true },
    lastUsedAt: { type: String, required: true },
    changeReason: { type: String },
    requestedAt: { type: String },
    reviewNotes: { type: String },
    history: [
      {
        id: String,
        deviceFingerprint: String,
        devicePlatform: String,
        browserName: String,
        action: String,
        actorId: String,
        actorRole: String,
        timestamp: String,
        reason: String,
      },
    ],
  },
  { timestamps: true }
);

const AttendanceSubmissionAttemptSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true, index: true },
    studentId: { type: String, required: true, index: true },
    studentName: { type: String, required: true },
    studentIdentifier: { type: String, required: true, index: true },
    sectionId: { type: String, required: true, index: true },
    sectionDisplayName: { type: String, required: true },
    subjectId: { type: String, required: true, index: true },
    subjectCode: { type: String, required: true },
    subjectName: { type: String, required: true },
    facultyId: { type: String, required: true, index: true },
    submittedAt: { type: String, required: true },
    serverTimestamp: { type: Number, required: true },
    qrTokenReference: { type: String, required: true },
    reportedLatitude: { type: Number, required: true },
    reportedLongitude: { type: Number, required: true },
    reportedAccuracy: { type: Number, required: true },
    calculatedDistanceMeters: { type: Number, required: true },
    calculatedHostDistanceMeters: { type: Number },
    isWithinRadius: { type: Boolean, required: true },
    isAccuracyAcceptable: { type: Boolean, required: true },
    deviceFingerprint: { type: String, required: true, index: true },
    devicePlatform: { type: String, required: true },
    deviceStatus: {
      type: String,
      enum: ['Registered', 'Pending_Device', 'Unrecognized'],
      required: true,
    },
    classification: {
      type: String,
      enum: ['VERIFIED', 'REVIEW_REQUIRED', 'REJECTED'],
      required: true,
      index: true,
    },
    rejectionOrReviewReason: { type: String },
    suspiciousSignals: [{ type: String }],
    attendanceRecordCreated: { type: Boolean, default: false },
    attendanceRecordId: { type: String },
  },
  { timestamps: true }
);

const RandomInClassVerificationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true, index: true },
    facultyId: { type: String, required: true, index: true },
    studentId: { type: String, required: true, index: true },
    studentName: { type: String, required: true },
    studentIdentifier: { type: String, required: true },
    challengeCode: { type: String, required: true },
    initiatedAt: { type: String, required: true },
    expiresAt: { type: String, required: true },
    windowMinutes: { type: Number, default: 3 },
    status: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'MISSED', 'FLAGGED'],
      default: 'PENDING',
      index: true,
    },
    respondedAt: { type: String },
    notes: { type: String },
  },
  { timestamps: true }
);

export const AcademicSectionModel =
  mongoose.models.AcademicSection || mongoose.model('AcademicSection', AcademicSectionSchema);
export const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
export const SubjectModel = mongoose.models.Subject || mongoose.model('Subject', SubjectSchema);
export const FacultyAssignmentModel =
  mongoose.models.FacultyAssignment ||
  mongoose.model('FacultyAssignment', FacultyAssignmentSchema);
export const ClassSessionModel =
  mongoose.models.ClassSession || mongoose.model('ClassSession', ClassSessionSchema);
export const AttendanceRecordModel =
  mongoose.models.AttendanceRecord || mongoose.model('AttendanceRecord', AttendanceRecordSchema);
export const CorrectionRequestModel =
  mongoose.models.CorrectionRequest || mongoose.model('CorrectionRequest', CorrectionRequestSchema);
export const AuditLogModel =
  mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
export const TimetableEntryModel =
  mongoose.models.TimetableEntry || mongoose.model('TimetableEntry', TimetableEntrySchema);
export const NotificationModel =
  mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
export const PolicyModel = mongoose.models.Policy || mongoose.model('Policy', PolicySchema);
export const QRAttendanceSessionModel =
  mongoose.models.QRAttendanceSession ||
  mongoose.model('QRAttendanceSession', QRAttendanceSessionSchema);
export const StudentDeviceBindingModel =
  mongoose.models.StudentDeviceBinding ||
  mongoose.model('StudentDeviceBinding', StudentDeviceBindingSchema);
export const AttendanceSubmissionAttemptModel =
  mongoose.models.AttendanceSubmissionAttempt ||
  mongoose.model('AttendanceSubmissionAttempt', AttendanceSubmissionAttemptSchema);
export const RandomInClassVerificationModel =
  mongoose.models.RandomInClassVerification ||
  mongoose.model('RandomInClassVerification', RandomInClassVerificationSchema);

