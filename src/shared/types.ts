export type UserRole = 'student' | 'faculty' | 'admin';

export type AttendanceStatus =
  | 'Present'
  | 'Absent'
  | 'Excused'
  | 'Corrected';

export type ClassSessionStatus =
  | 'Scheduled'
  | 'Confirmed'
  | 'Conducted'
  | 'Cancelled'
  | 'Rescheduled';

export type ClassSessionType =
  | 'Regular'
  | 'Extra'
  | 'Replacement'
  | 'Swapped';

export type RecordSource =
  | 'Faculty Register'
  | 'Biometric Terminal'
  | 'LMS Sync'
  | 'Approved Correction'
  | 'QR Geoverified';

export type CorrectionWorkflowStatus =
  | 'Draft'
  | 'Submitted'
  | 'Under Review'
  | 'Additional Evidence Requested'
  | 'Approved'
  | 'Rejected'
  | 'Withdrawn';

export type SubjectStanding =
  | 'On Track'
  | 'Needs Attention'
  | 'At Risk'
  | 'Insufficient Data';

export type CalculationMethod = 'simple_count' | 'weighted_hours';
export type CancelledClassPolicy = 'exclude_from_conducted' | 'count_as_conducted';
export type ExcusedAbsencePolicy =
  | 'count_as_attended'
  | 'exclude_from_conducted'
  | 'count_as_missed';

export type AuditCategory =
  | 'ATTENDANCE_RECORD'
  | 'CORRECTION_WORKFLOW'
  | 'STUDENT_SECTION'
  | 'FACULTY_ASSIGNMENT'
  | 'TIMETABLE'
  | 'CLASS_SESSION'
  | 'ACCOUNT_ADMIN'
  | 'POLICY'
  | 'ACCOUNT_SECURITY';

export interface InstitutionalPolicy {
  id: string;
  institutionName: string;
  academicYear: string;
  semester: number;
  programme: string;
  defaultMinimumPercentage: number;
  warningBufferPercentage: number;
  calculationMethod: CalculationMethod;
  cancelledClassPolicy: CancelledClassPolicy;
  excusedAbsencePolicy: ExcusedAbsencePolicy;
  approvalPermissions: UserRole[];
  evidenceRequiredForSubmission: boolean;
  maxEvidenceSizeMB: number;
  allowedEvidenceTypes: string[];
  allowAppeals: boolean;
  appealWindowDays: number;
  allowFacultyExtraClassRequests: boolean;
  enforceRoomConflictCheck: boolean;
  // QR & Geofencing Policies
  campusLatitude: number; // e.g. 15.8858 (VTU Jnana Sangama Belagavi)
  campusLongitude: number; // e.g. 74.5298
  permittedRadiusMeters: number; // e.g. 350 meters (Campus perimeter)
  teacherHostRadiusMeters: number; // teacher host proximity geofence radius (default 50m)
  maxAcceptableGpsAccuracyMeters: number; // e.g. 80 meters (or 15 meters for teacher)
  qrRefreshSeconds: number; // e.g. 5 seconds dynamic QR rotation
  defaultSessionDurationMinutes: number; // e.g. 5 minutes
  randomVerificationWindowMinutes: number; // e.g. 3 minutes
  enforceDeviceRegistration: boolean;
  policyLastVerifiedNote: string;
  updatedAt: string;
}

export type VerificationClassification = 'VERIFIED' | 'REVIEW_REQUIRED' | 'REJECTED';

export interface QRAttendanceSession {
  id: string;
  classId?: string;
  sectionId: string;
  sectionDisplayName: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  facultyId: string;
  facultyName: string;
  classroom: string;
  hostLatitude?: number;
  hostLongitude?: number;
  hostAccuracy?: number;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string;
  currentQrToken: string;
  tokenExpiresAt: number; // epoch ms
  tokenIssuedAt: number; // epoch ms
  sessionExpiresAt: number; // epoch ms
  durationMinutes: number;
  status: 'ACTIVE' | 'CLOSED';
  refreshCount: number;
  totalEnrolled: number;
  verifiedCount: number;
  reviewRequiredCount: number;
  rejectedCount: number;
  createdAt: string;
  closedAt?: string;
}

export interface DeviceRegistrationEvent {
  id: string;
  deviceFingerprint: string;
  devicePlatform: string;
  browserName: string;
  action: 'FIRST_REGISTRATION' | 'DEVICE_CHANGE_REQUESTED' | 'APPROVED' | 'REJECTED' | 'ADMIN_RESET';
  actorId?: string;
  actorRole?: string;
  timestamp: string;
  reason?: string;
}

export interface StudentDeviceBinding {
  id: string;
  studentId: string;
  studentName: string;
  studentIdentifier: string;
  sectionDisplayName?: string;
  deviceFingerprint: string;
  devicePlatform: string;
  browserName: string;
  status: 'Approved' | 'Pending_Approval' | 'Rejected';
  registeredAt: string;
  lastUsedAt: string;
  changeReason?: string;
  requestedAt?: string;
  reviewNotes?: string;
  history?: DeviceRegistrationEvent[];
}

export interface AttendanceSubmissionAttempt {
  id: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  studentIdentifier: string;
  sectionId: string;
  sectionDisplayName: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  facultyId: string;
  submittedAt: string;
  serverTimestamp: number;
  qrTokenReference: string;
  reportedLatitude: number;
  reportedLongitude: number;
  reportedAccuracy: number;
  calculatedDistanceMeters: number;
  calculatedHostDistanceMeters?: number;
  isWithinRadius: boolean;
  isAccuracyAcceptable: boolean;
  deviceFingerprint: string;
  devicePlatform: string;
  deviceStatus: 'Registered' | 'Pending_Device' | 'Unrecognized';
  classification: VerificationClassification;
  rejectionOrReviewReason?: string;
  suspiciousSignals: string[];
  attendanceRecordCreated: boolean;
  attendanceRecordId?: string;
}

export interface RandomInClassVerification {
  id: string;
  sessionId: string;
  facultyId: string;
  studentId: string;
  studentName: string;
  studentIdentifier: string;
  challengeCode: string;
  initiatedAt: string;
  expiresAt: string;
  windowMinutes: number;
  status: 'PENDING' | 'VERIFIED' | 'MISSED' | 'FLAGGED';
  respondedAt?: string;
  notes?: string;
}

export interface AcademicSection {
  id: string;
  department: string; // e.g. "CSE", "CSBS", "AIDS"
  sectionName: string; // e.g. "A", "B"
  displayName: string; // e.g. "CSE A"
  semester: number;
  academicYear: string;
  programme: string;
  defaultClassroom: string;
  status: 'Active' | 'Archived';
  isDemo: boolean;
}

export interface FacultyUnavailabilitySlot {
  id: string;
  date?: string; // Specific date YYYY-MM-DD (optional if recurring dayOfWeek)
  dayOfWeek?: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';
  startTime: string;
  endTime: string;
  reason: string;
}

export interface UserProfile {
  id: string;
  name: string;
  identifier: string; // USN for student, Faculty ID or Admin ID
  email: string;
  role: UserRole;
  college: string;
  department: string;
  programme: string;
  semester: number;
  section: string; // e.g. "A"
  sectionId?: string; // Reference to AcademicSection.id for students
  sectionDisplayName?: string; // e.g. "CSE A"
  academicYear?: string;
  rollNumber?: string;
  designation?: string; // For faculty/admin
  phone?: string;
  unavailableSlots?: FacultyUnavailabilitySlot[];
  accountStatus: 'Active' | 'Inactive' | 'Suspended';
  isDemo: boolean;
  isRegistered?: boolean;
  tokenVersion?: number;
}

export interface IdentifyFaceResponse {
  matched: boolean;
  isProxy?: boolean;
  matchedUsn?: string;
  expectedUsn?: string;
  studentName?: string;
  similarity?: number;
  message: string;
}

export interface CentralizedAttendanceRosterItem {
  studentId: string;
  studentName: string;
  studentIdentifier: string;
  sectionDisplayName: string;
  record?: AttendanceRecord;
  status: 'Present' | 'Absent' | 'Excused' | 'Pending';
  recordSource?: RecordSource;
  timestamp?: string;
  recordedByName?: string;
  conflictAlert?: string;
  verificationMethod: 'QR' | 'Manual' | 'None';
}

export interface CentralizedAttendanceSummary {
  totalEnrolled: number;
  presentCount: number;
  absentCount: number;
  excusedCount: number;
  pendingCount: number;
  completionPercentage: number;
}

export interface SubjectItem {
  id: string;
  code: string;
  name: string;
  department: string;
  semester: number;
  programme: string;
  credits: number;
  attendanceRequirement: number;
  assignedFacultyId: string; // Default/coordinator faculty reference
  assignedFacultyName: string;
  academicYear: string;
  estimatedRemainingClasses: number;
  status: 'Active' | 'Archived';
  isDemo: boolean;
}

export interface FacultyAssignment {
  id: string;
  facultyId: string;
  facultyName: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  sectionId: string;
  sectionDisplayName: string;
  department: string;
  semester: number;
  academicYear: string;
  startDate: string;
  endDate: string;
  status: 'Active' | 'Inactive';
  isDemo: boolean;
}

export interface ClassSession {
  id: string;
  sectionId: string;
  sectionDisplayName: string;
  subjectId: string;
  subjectCode?: string;
  subjectName?: string;
  timetableEntryId?: string;
  originalSessionId?: string; // Links replacement session to cancelled/rescheduled session
  replacementSessionId?: string; // Links cancelled/rescheduled session forward to replacement
  date: string; // YYYY-MM-DD
  period: string; // e.g. "Period 1 (09:00 - 09:55)"
  startTime: string;
  endTime: string;
  durationHours: number;
  topic: string;
  sessionType: ClassSessionType;
  status: ClassSessionStatus;
  scheduledFacultyId: string;
  scheduledFacultyName: string;
  facultyId: string; // Actual conducting faculty ID (regular or substitute)
  facultyName: string; // Actual conducting faculty Name
  isSubstitute: boolean;
  classroom: string;
  batch?: 'B1' | 'B2' | 'All';
  attendanceSubmitted: boolean;
  cancellationReason?: string;
  rescheduleReason?: string;
  extraClassReason?: string;
  notes?: string;
  approvalStatus: 'Approved' | 'Pending Approval' | 'Rejected';
  createdBy?: string;
  updatedBy?: string;
  isDemo: boolean;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  classId: string;
  attendanceSessionId?: string;
  sectionId: string; // Preserves historical section at the time of session!
  subjectId: string;
  status: AttendanceStatus;
  effectivePresent: boolean;
  originalStatus: AttendanceStatus;
  recordSource: RecordSource;
  recordedById: string;
  recordedByName: string;
  timestamp: string;
  correctionVersion: number;
  pendingRequestId?: string;
}

export interface EvidenceFileMeta {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  documentCategory: string;
  uploadedAt: string;
}

export interface EvidenceAccessLog {
  viewerId: string;
  viewerName: string;
  viewerRole: UserRole;
  fileName: string;
  accessedAt: string;
}

export interface TimelineStep {
  status: CorrectionWorkflowStatus;
  actorName: string;
  actorRole: UserRole;
  note: string;
  timestamp: string;
}

export interface AttendanceCorrectionRequest {
  id: string;
  referenceNumber: string;
  studentId: string;
  studentName: string;
  studentIdentifier: string;
  sectionId: string;
  sectionDisplayName: string;
  attendanceRecordId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  classId: string;
  classDate: string;
  classPeriod: string;
  classTopic: string;
  originalStatus: AttendanceStatus;
  requestedStatus: 'Present' | 'Excused';
  reason: string;
  supportingNotes: string;
  evidenceFiles: EvidenceFileMeta[];
  evidenceAccessLogs: EvidenceAccessLog[];
  workflowStatus: CorrectionWorkflowStatus;
  reviewerId?: string;
  reviewerName?: string;
  decisionReason?: string;
  appealCount: number;
  timeline: TimelineStep[];
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceAuditLog {
  id: string;
  category: AuditCategory;
  attendanceRecordId: string;
  sectionId?: string;
  sectionDisplayName?: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  classId: string;
  classDate: string;
  classPeriod: string;
  studentId: string;
  studentName: string;
  studentIdentifier: string;
  previousValue: string;
  newValue: string;
  previousVersion: number;
  newVersion: number;
  action: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  correctionRequestId?: string;
  correctionReferenceNumber?: string;
  reason: string;
  evidenceReference: string;
  timestamp: string;
}

export interface TimetableEntry {
  id: string;
  sectionId: string;
  sectionDisplayName: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  facultyAssignmentId: string;
  facultyId: string;
  facultyName: string;
  dayOfWeek: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';
  period: string;
  startTime: string;
  endTime: string;
  classroom: string;
  batch?: 'B1' | 'B2' | 'All';
  validityPeriod: string;
  upcomingDate: string;
  upcomingStatus: ClassSessionStatus;
  status: 'Active' | 'Inactive';
}

export interface AppNotification {
  id: string;
  recipientId: string;
  type:
    | 'ATTENDANCE_ALERT'
    | 'CORRECTION_SUBMITTED'
    | 'CORRECTION_UPDATE'
    | 'TIMETABLE_CHANGE'
    | 'EXTRA_CLASS'
    | 'POLICY_NOTICE';
  title: string;
  message: string;
  relatedRecordId?: string;
  targetNav?: NavigationSection;
  read: boolean;
  timestamp: string;
}

export type NavigationSection =
  | 'dashboard'
  | 'my-attendance'
  | 'subject-reports'
  | 'corrections'
  | 'timetable'
  | 'reports'
  | 'profile'
  | 'qr-attendance'
  // Administrator Dedicated Navigation Sections
  | 'admin-attendance-monitoring'
  | 'admin-students'
  | 'admin-faculty'
  | 'admin-sections'
  | 'admin-subjects'
  | 'admin-assignments'
  | 'admin-timetable'
  | 'admin-extra-classes'
  | 'admin-audit-logs'
  | 'admin-facial-model';

export interface SubjectAttendanceComputed {
  subject: SubjectItem;
  conducted: number;
  attended: number;
  missed: number;
  excused: number;
  cancelled: number;
  rescheduledCount: number;
  extraConductedCount: number;
  pendingCorrections: number;
  approvedCorrections: number;
  percentage: number | null;
  requiredPercentage: number;
  differenceFromRequired: number | null;
  classesNeededToRecover: number;
  maxSafeMisses: number;
  standing: SubjectStanding;
  scheduledThisWeek: number;
  projectedIfAttendWeek: number | null;
}

export interface OverallAttendanceSummary {
  overallPercentage: number | null;
  totalConducted: number;
  totalAttended: number;
  totalMissed: number;
  totalExcused: number;
  totalCancelled: number;
  subjectsBelowThreshold: number;
  subjectsAtRisk: number;
  subjectsNeedingAttention: number;
  subjectsOnTrack: number;
  headlineMessage: string;
}

export interface RecommendationItem {
  id: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  severity: 'critical' | 'warning' | 'positive' | 'info';
  title: string;
  explanation: string;
  currentPercentage: number | null;
  requiredPercentage: number;
  projectedPercentage: number | null;
  classesRequired: number;
  scheduledThisWeek: number;
  unreachableInRemaining: boolean;
}

export interface ConflictDetail {
  type: 'FACULTY_BUSY' | 'FACULTY_UNAVAILABLE' | 'SECTION_BUSY' | 'ROOM_BUSY' | 'ORIGINAL_CONDUCTED' | 'INVALID_TIME';
  message: string;
}

// ============================================================================
// FACIAL BIOMETRIC RECOGNITION, LIVENESS & MODEL TRAINING TYPES
// ============================================================================

export type BlinkSequenceStage =
  | 'WAITING_FACE'
  | 'CALIBRATING_OPEN'
  | 'EYES_OPEN_READY'
  | 'EYES_CLOSED_DETECTED'
  | 'BLINK_COMPLETED'
  | 'FAILED';

export type LivenessChallengeType =
  | 'BLINK_AND_HEAD_LEFT'
  | 'BLINK_AND_HEAD_RIGHT'
  | 'BLINK_AND_NOD';

export type RecognitionModelId = 'arcface-w600k-mbf-512d' | 'resnet34-128d';

export interface FaceQualityMetrics {
  passed: boolean;
  sharpnessScore: number;
  luminanceScore: number;
  interOcularPx: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  withinBounds: boolean;
  failureReason: string | null;
}

export interface LivenessTelemetry {
  blinkStage: BlinkSequenceStage;
  blinkDetected: boolean;
  blinkCount: number;
  minEarObserved: number;
  maxEarObserved: number;
  avgOpenEar: number;
  motionVarianceScore: number;
  depthParallaxScore?: number;
  challengeType?: LivenessChallengeType;
  challengeCompleted?: boolean;
  frameSamplesEvaluated: number;
  sequenceTimestamps: {
    openInitialAt?: number;
    closedAt?: number;
    challengeActionAt?: number;
    reopenedAt?: number;
  };
}

export interface VerificationSessionDescriptor {
  verificationSessionId: string;
  studentId: string;
  qrSessionId: string;
  challengeType: LivenessChallengeType;
  challengeInstruction: string;
  challengeNonce: string;
  issuedAt: string;
  expiresAt: string;
  sessionToken: string;
}

export interface VerificationEvidenceFrames {
  /** Cropped face/upper-head frame while looking straight ahead with eyes open */
  baselineOpenJpeg: string;
  /** Cropped frame captured at eye-closure peak during natural blink */
  blinkClosedJpeg: string;
  /** Cropped frame captured at randomized head movement peak (left/right/nod) */
  challengeActionJpeg: string;
  /** Cropped frame captured after completing blink + head action, looking forward with eyes open */
  postChallengeOpenJpeg: string;
}

export interface VerificationRequestPayload {
  verificationSessionId: string;
  sessionToken: string;
  qrSessionId?: string;
  evidenceFrames: VerificationEvidenceFrames;
}

export interface VerificationResult {
  studentId: string;
  qrSessionId: string;
  verificationSessionId: string;
  challengeType: LivenessChallengeType;
  faceDetected: boolean;
  faceMatch: 'MATCH' | 'NO_MATCH';
  blinkDetected: boolean;
  livenessVerified: boolean;
  verificationStatus: 'VERIFIED' | 'FAILED';
  modelId: RecognitionModelId;
  modelVersion: string;
  confidenceScore: number | null;
  euclideanDistance: number | null;
  cosineSimilarity: number | null;
  thresholdUsed: number;
  failureReason: string | null;
  verifiedAt: string;
  resultSignature: string;
  record?: AttendanceRecord;
  attempt?: AttendanceSubmissionAttempt;
  latencyBreakdown?: {
    detectionMs: number;
    embeddingMs: number;
    verificationMs: number;
    totalMs: number;
  };
}

export interface EnrolledSampleMetadata {
  sampleId: string;
  angleLabel?: string;
  lightingLabel?: string;
  qualityScore?: number;
  enrolledAt: string;
}

export interface EnrolledSubjectRecord {
  subjectId: string;
  displayName?: string;
  modelId: RecognitionModelId;
  modelVersion: string;
  embeddingDim: number;
  embeddings: number[][];
  centroidEmbedding: number[];
  samples: EnrolledSampleMetadata[];
  consentConfirmed: boolean;
  consentRecordedAt: string;
  updatedAt: string;
}

export interface IdentificationCandidate {
  subjectId: string;
  displayName?: string;
  cosineSimilarity: number;
  euclideanDistance: number;
}

export type TrainingRunState = 'idle' | 'preparing' | 'training' | 'completed' | 'failed' | 'stopped';

export interface TrainingEpochRecord {
  epoch: number;
  train_loss: number;
  val_eer: number;
  val_th: number;
}

export interface TrainingJobStatus {
  state: TrainingRunState;
  currentEpoch: number;
  totalEpochs: number;
  currentLoss: number | null;
  bestValEer: number | null;
  bestValThreshold: number | null;
  device: string;
  datasetIdentities: number;
  datasetSamples: number;
  logs: string[];
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface ModelVersionRecord {
  id: string;
  versionName: string;
  modelId: RecognitionModelId;
  backboneArchitecture: string;
  description: string;
  status: 'active' | 'standby' | 'candidate';
  trainedOn: string;
  valEer: number;
  recommendedThreshold: number;
  onnxPath: string;
  checkpointPath?: string;
  createdAt: string;
  isPretrainedBaseline: boolean;
}

export interface CalibrationMetricRow {
  threshold: number;
  far: number;
  frr: number;
  eer: number;
}

export interface ModelCalibrationReport {
  evaluatedModelId: string;
  evaluatedModelVersion: string;
  testSampleCount: number;
  subjectCount: number;
  genuinePairsEvaluated: number;
  impostorPairsEvaluated: number;
  bestThreshold: number;
  bestEer: number;
  farAtRecommendedThreshold: number;
  frrAtRecommendedThreshold: number;
  curve: CalibrationMetricRow[];
  calibratedAt: string;
}

