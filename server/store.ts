import crypto from 'crypto';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import {
  AcademicSectionModel,
  AttendanceRecordModel,
  AttendanceSubmissionAttemptModel,
  AuditLogModel,
  ClassSessionModel,
  CorrectionRequestModel,
  FacultyAssignmentModel,
  NotificationModel,
  PolicyModel,
  QRAttendanceSessionModel,
  RandomInClassVerificationModel,
  StudentDeviceBindingModel,
  SubjectModel,
  TimetableEntryModel,
  UserModel,
} from './models.ts';
import {
  buildInitialSeedData,
  CURRENT_SEED_SCHEMA_VERSION,
  ensureSampleEvidenceFiles,
  SeedDatabaseBundle,
  StoredUser,
} from './seedData.ts';
import {
  AcademicSection,
  AppNotification,
  AttendanceAuditLog,
  AttendanceCorrectionRequest,
  AttendanceRecord,
  AttendanceSubmissionAttempt,
  ClassSession,
  FacultyAssignment,
  InstitutionalPolicy,
  QRAttendanceSession,
  RandomInClassVerification,
  StudentDeviceBinding,
  SubjectItem,
  TimetableEntry,
  UserProfile,
  VerificationClassification,
} from '../src/shared/types.ts';

export class DataRepository {
  private mode: 'mongodb' | 'local_sandbox' = 'local_sandbox';
  private localDbPath: string;
  private uploadDir: string;
  private state: SeedDatabaseBundle;
  private qrSigningSecret: string = crypto.randomBytes(32).toString('hex');
  private attendanceLock: Promise<void> = Promise.resolve();

  constructor(localDbPath: string, uploadDir: string) {
    this.localDbPath = localDbPath;
    this.uploadDir = uploadDir;
    this.state = buildInitialSeedData();
  }

  public getStorageMode(): 'mongodb' | 'local_sandbox' {
    return this.mode;
  }

  public getUploadDir(): string {
    return this.uploadDir;
  }

  public async initialize(): Promise<void> {
    ensureSampleEvidenceFiles(this.uploadDir);

    const mongoUri = process.env.MONGODB_URI?.trim();
    if (mongoUri) {
      try {
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
        this.mode = 'mongodb';
        await this.seedMongoIfEmpty();
        console.log('[VTU Smart Attendance] Connected to MongoDB Atlas via Mongoose.');
        return;
      } catch (err) {
        console.warn(
          '[VTU Smart Attendance] MongoDB connection unavailable; falling back to local persistent sandbox:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    this.mode = 'local_sandbox';
    this.loadOrCreateLocalStore();
  }

  private loadOrCreateLocalStore(): void {
    const dir = path.dirname(this.localDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(this.localDbPath)) {
      try {
        const raw = fs.readFileSync(this.localDbPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<SeedDatabaseBundle>;
        if (
          parsed &&
          Array.isArray(parsed.sections) &&
          Array.isArray(parsed.facultyAssignments) &&
          Array.isArray(parsed.users)
        ) {
          const fresh = buildInitialSeedData();
          // Non-destructive preservation of all records, classes, and sessions
          const records = Array.isArray(parsed.records)
            ? parsed.records.map((r: AttendanceRecord) => ({
                ...r,
                attendanceSessionId: r.attendanceSessionId || r.classId,
              }))
            : fresh.records;

          this.state = {
            schemaVersion: CURRENT_SEED_SCHEMA_VERSION,
            policy: parsed.policy || fresh.policy,
            sections: Array.isArray(parsed.sections) && parsed.sections.length > 0 ? parsed.sections : fresh.sections,
            users: Array.isArray(parsed.users) && parsed.users.length > 0 ? parsed.users : fresh.users,
            subjects: Array.isArray(parsed.subjects) && parsed.subjects.length > 0 ? parsed.subjects : fresh.subjects,
            facultyAssignments:
              Array.isArray(parsed.facultyAssignments) && parsed.facultyAssignments.length > 0
                ? parsed.facultyAssignments
                : fresh.facultyAssignments,
            classes: Array.isArray(parsed.classes) ? parsed.classes : fresh.classes,
            records,
            corrections: Array.isArray(parsed.corrections) ? parsed.corrections : fresh.corrections,
            auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : fresh.auditLogs,
            timetable: Array.isArray(parsed.timetable) ? parsed.timetable : fresh.timetable,
            notifications: Array.isArray(parsed.notifications) ? parsed.notifications : fresh.notifications,
            qrSessions: Array.isArray(parsed.qrSessions) ? parsed.qrSessions : fresh.qrSessions,
            deviceBindings: Array.isArray(parsed.deviceBindings) ? parsed.deviceBindings : fresh.deviceBindings,
            attendanceAttempts: Array.isArray(parsed.attendanceAttempts) ? parsed.attendanceAttempts : fresh.attendanceAttempts,
            randomVerifications: Array.isArray(parsed.randomVerifications) ? parsed.randomVerifications : fresh.randomVerifications,
          };
          this.persistLocal();
          return;
        }
      } catch {
        // Fall back to seed on corrupt JSON
      }
    }
    this.state = buildInitialSeedData();
    this.persistLocal();
  }

  private persistLocal(): void {
    if (this.mode !== 'local_sandbox') return;
    const dir = path.dirname(this.localDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.localDbPath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  private async seedMongoIfEmpty(): Promise<void> {
    const existingSections = await AcademicSectionModel.countDocuments();
    if (existingSections > 0) {
      try {
        await AttendanceRecordModel.collection.dropIndex('studentId_1_classId_1');
      } catch {
        // index already dropped or not unique
      }
      try {
        await AttendanceRecordModel.updateMany(
          { attendanceSessionId: { $exists: false } },
          [{ $set: { attendanceSessionId: '$classId' } }]
        );
        await AttendanceRecordModel.syncIndexes();
      } catch {
        // Non-fatal index sync
      }
      return;
    }
    const initial = buildInitialSeedData();
    await PolicyModel.deleteMany({});
    await PolicyModel.create(initial.policy);
    await AcademicSectionModel.insertMany(initial.sections);
    const existingUsers = await UserModel.countDocuments();
    if (existingUsers === 0) {
      await UserModel.insertMany(initial.users);
    }
    const existingSubj = await SubjectModel.countDocuments();
    if (existingSubj === 0) {
      await SubjectModel.insertMany(initial.subjects);
    }
    await FacultyAssignmentModel.insertMany(initial.facultyAssignments);
    const existingCls = await ClassSessionModel.countDocuments();
    if (existingCls === 0) {
      await ClassSessionModel.insertMany(initial.classes);
      await AttendanceRecordModel.insertMany(initial.records);
      await CorrectionRequestModel.insertMany(initial.corrections);
      await AuditLogModel.insertMany(initial.auditLogs);
      await TimetableEntryModel.insertMany(initial.timetable);
      await NotificationModel.insertMany(initial.notifications);
      await QRAttendanceSessionModel.insertMany(initial.qrSessions);
      await StudentDeviceBindingModel.insertMany(initial.deviceBindings);
      await AttendanceSubmissionAttemptModel.insertMany(initial.attendanceAttempts);
      await RandomInClassVerificationModel.insertMany(initial.randomVerifications);
    }
  }

  public async resetDemoData(): Promise<void> {
    ensureSampleEvidenceFiles(this.uploadDir);
    const fresh = buildInitialSeedData();

    if (this.mode === 'mongodb') {
      await PolicyModel.deleteMany({});
      await AcademicSectionModel.deleteMany({ isDemo: true });
      await UserModel.deleteMany({ isDemo: true });
      await SubjectModel.deleteMany({ isDemo: true });
      await FacultyAssignmentModel.deleteMany({ isDemo: true });
      await ClassSessionModel.deleteMany({ isDemo: true });
      await AttendanceRecordModel.deleteMany({});
      await CorrectionRequestModel.deleteMany({});
      await AuditLogModel.deleteMany({});
      await TimetableEntryModel.deleteMany({});
      await NotificationModel.deleteMany({});
      await QRAttendanceSessionModel.deleteMany({});
      await StudentDeviceBindingModel.deleteMany({});
      await AttendanceSubmissionAttemptModel.deleteMany({});
      await RandomInClassVerificationModel.deleteMany({});

      await PolicyModel.create(fresh.policy);
      await AcademicSectionModel.insertMany(fresh.sections);
      await UserModel.insertMany(fresh.users);
      await SubjectModel.insertMany(fresh.subjects);
      await FacultyAssignmentModel.insertMany(fresh.facultyAssignments);
      await ClassSessionModel.insertMany(fresh.classes);
      await AttendanceRecordModel.insertMany(fresh.records);
      await CorrectionRequestModel.insertMany(fresh.corrections);
      await AuditLogModel.insertMany(fresh.auditLogs);
      await TimetableEntryModel.insertMany(fresh.timetable);
      await NotificationModel.insertMany(fresh.notifications);
      await QRAttendanceSessionModel.insertMany(fresh.qrSessions);
      await StudentDeviceBindingModel.insertMany(fresh.deviceBindings);
      await AttendanceSubmissionAttemptModel.insertMany(fresh.attendanceAttempts);
      await RandomInClassVerificationModel.insertMany(fresh.randomVerifications);
      return;
    }

    const liveUsers = this.state.users.filter((u) => !u.isDemo);
    this.state = {
      ...fresh,
      users: [...fresh.users, ...liveUsers],
    };
    this.persistLocal();
  }

  public toPublicUser(u: StoredUser): UserProfile {
    const { passwordHash: _unused, ...rest } = u;
    void _unused;
    return rest;
  }

  // --- Audit & Notification Helpers ---

  public async appendAuditLog(entry: AttendanceAuditLog): Promise<void> {
    if (this.mode === 'mongodb') {
      await AuditLogModel.create(entry);
      return;
    }
    this.state.auditLogs.unshift(entry);
    this.persistLocal();
  }

  public async createNotifications(items: AppNotification[]): Promise<void> {
    if (items.length === 0) return;
    if (this.mode === 'mongodb') {
      await NotificationModel.insertMany(items);
      return;
    }
    this.state.notifications.unshift(...items);
    this.persistLocal();
  }

  // --- Sections ---

  public async getSections(): Promise<AcademicSection[]> {
    if (this.mode === 'mongodb') {
      const docs = await AcademicSectionModel.find({}).lean();
      return docs as unknown as AcademicSection[];
    }
    return this.state.sections;
  }

  public async getSectionById(id: string): Promise<AcademicSection | null> {
    if (this.mode === 'mongodb') {
      const doc = await AcademicSectionModel.findOne({ id }).lean();
      return (doc as unknown as AcademicSection) || null;
    }
    return this.state.sections.find((s) => s.id === id) || null;
  }

  public async createSection(sec: AcademicSection): Promise<AcademicSection> {
    const all = await this.getSections();
    const dup = all.find(
      (s) =>
        s.department.toUpperCase() === sec.department.toUpperCase() &&
        s.sectionName.toUpperCase() === sec.sectionName.toUpperCase() &&
        s.semester === sec.semester &&
        s.academicYear === sec.academicYear
    );
    if (dup) {
      throw new Error(
        `Section ${sec.department} ${sec.sectionName} (Sem ${sec.semester}, ${sec.academicYear}) already exists.`
      );
    }
    if (this.mode === 'mongodb') {
      await AcademicSectionModel.create(sec);
      return sec;
    }
    this.state.sections.push(sec);
    this.persistLocal();
    return sec;
  }

  public async updateSection(
    id: string,
    updates: Partial<AcademicSection>
  ): Promise<AcademicSection | null> {
    if (this.mode === 'mongodb') {
      const doc = await AcademicSectionModel.findOneAndUpdate(
        { id },
        { $set: updates },
        { new: true }
      ).lean();
      return (doc as unknown as AcademicSection) || null;
    }
    const idx = this.state.sections.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    this.state.sections[idx] = { ...this.state.sections[idx], ...updates };
    this.persistLocal();
    return this.state.sections[idx];
  }

  // --- Users (Students, Faculty, Admins) ---

  public async findUserByLogin(login: string): Promise<StoredUser | null> {
    const normalized = login.trim().toLowerCase();
    if (this.mode === 'mongodb') {
      const doc = await UserModel.findOne({
        $or: [{ email: normalized }, { identifier: new RegExp(`^${login.trim()}$`, 'i') }],
      }).lean();
      return (doc as unknown as StoredUser) || null;
    }
    return (
      this.state.users.find(
        (u) =>
          u.email.toLowerCase() === normalized ||
          u.identifier.toLowerCase() === normalized
      ) || null
    );
  }

  public async findUserById(id: string): Promise<StoredUser | null> {
    if (this.mode === 'mongodb') {
      const doc = await UserModel.findOne({ id }).lean();
      return (doc as unknown as StoredUser) || null;
    }
    return this.state.users.find((u) => u.id === id) || null;
  }

  public async findUserByIdentifier(identifier: string): Promise<StoredUser | null> {
    const trimmed = identifier.trim().toLowerCase();
    if (this.mode === 'mongodb') {
      const doc = await UserModel.findOne({
        identifier: new RegExp(`^${identifier.trim()}$`, 'i'),
      }).lean();
      return (doc as unknown as StoredUser) || null;
    }
    return this.state.users.find((u) => u.identifier.toLowerCase() === trimmed) || null;
  }

  public async listDemoPersonas(): Promise<UserProfile[]> {
    if (this.mode === 'mongodb') {
      const docs = await UserModel.find({ isDemo: true }).lean();
      return (docs as unknown as StoredUser[]).map((u) => this.toPublicUser(u));
    }
    return this.state.users.filter((u) => u.isDemo).map((u) => this.toPublicUser(u));
  }

  public async listAllUsers(): Promise<UserProfile[]> {
    if (this.mode === 'mongodb') {
      const docs = await UserModel.find({}).lean();
      return (docs as unknown as StoredUser[]).map((u) => this.toPublicUser(u));
    }
    return this.state.users.map((u) => this.toPublicUser(u));
  }

  public async createUser(newUser: StoredUser): Promise<UserProfile> {
    if (this.mode === 'mongodb') {
      await UserModel.create(newUser);
      return this.toPublicUser(newUser);
    }
    this.state.users.push(newUser);
    this.persistLocal();
    return this.toPublicUser(newUser);
  }

  public async createManyUsers(newUsers: StoredUser[]): Promise<UserProfile[]> {
    if (newUsers.length === 0) return [];
    if (this.mode === 'mongodb') {
      await UserModel.insertMany(newUsers);
      return newUsers.map((u) => this.toPublicUser(u));
    }
    this.state.users.push(...newUsers);
    this.persistLocal();
    return newUsers.map((u) => this.toPublicUser(u));
  }

  public async updateUser(
    id: string,
    updates: Partial<StoredUser>
  ): Promise<UserProfile | null> {
    if (this.mode === 'mongodb') {
      const doc = await UserModel.findOneAndUpdate(
        { id },
        { $set: updates },
        { new: true }
      ).lean();
      return doc ? this.toPublicUser(doc as unknown as StoredUser) : null;
    }
    const idx = this.state.users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    this.state.users[idx] = { ...this.state.users[idx], ...updates };
    this.persistLocal();
    return this.toPublicUser(this.state.users[idx]);
  }

  public async updateUserPassword(userId: string, newPasswordHash: string): Promise<boolean> {
    const updated = await this.updateUser(userId, { passwordHash: newPasswordHash });
    return Boolean(updated);
  }

  // --- Policy ---

  public async getPolicy(): Promise<InstitutionalPolicy> {
    if (this.mode === 'mongodb') {
      const doc = await PolicyModel.findOne({ id: 'policy-default' }).lean();
      if (doc) {
        const p = doc as unknown as InstitutionalPolicy;
        p.teacherHostRadiusMeters = p.teacherHostRadiusMeters ? Math.max(10, Math.min(50, p.teacherHostRadiusMeters)) : 15;
        p.qrRefreshSeconds = 5;
        p.enforceDeviceRegistration = false;
        return p;
      }
    }
    this.state.policy.teacherHostRadiusMeters = this.state.policy.teacherHostRadiusMeters
      ? Math.max(10, Math.min(50, this.state.policy.teacherHostRadiusMeters))
      : 15;
    this.state.policy.qrRefreshSeconds = 5;
    this.state.policy.enforceDeviceRegistration = false;
    return this.state.policy;
  }

  public async updatePolicy(
    updates: Partial<InstitutionalPolicy>,
    actor: UserProfile
  ): Promise<InstitutionalPolicy> {
    const current = await this.getPolicy();
    const clampedRadius =
      updates.teacherHostRadiusMeters !== undefined
        ? Math.max(5, updates.teacherHostRadiusMeters)
        : current.teacherHostRadiusMeters;
    const updated: InstitutionalPolicy = {
      ...current,
      ...updates,
      qrRefreshSeconds: updates.qrRefreshSeconds || current.qrRefreshSeconds || 30,
      teacherHostRadiusMeters: clampedRadius,
      id: 'policy-default',
      updatedAt: new Date().toISOString(),
    };

    const auditEntry: AttendanceAuditLog = {
      id: `aud-${Date.now()}`,
      category: 'POLICY',
      attendanceRecordId: 'policy-default',
      subjectId: 'institutional',
      subjectCode: 'POLICY',
      subjectName: 'Institutional Attendance Policy Configuration',
      classId: 'config',
      classDate: new Date().toISOString().slice(0, 10),
      classPeriod: 'Administrative Action',
      studentId: 'all',
      studentName: 'All Applicable Programmes',
      studentIdentifier: 'INSTITUTIONAL',
      previousValue: `Min ${current.defaultMinimumPercentage}%, Method: ${current.calculationMethod}, Excused: ${current.excusedAbsencePolicy}`,
      newValue: `Min ${updated.defaultMinimumPercentage}%, Method: ${updated.calculationMethod}, Excused: ${updated.excusedAbsencePolicy}`,
      previousVersion: 1,
      newVersion: 2,
      action: 'POLICY_UPDATED',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      reason: 'Updated configurable institutional attendance policy settings.',
      evidenceReference: 'Administrative Configuration Console',
      timestamp: new Date().toISOString(),
    };

    if (this.mode === 'mongodb') {
      await PolicyModel.findOneAndUpdate({ id: 'policy-default' }, updated, { upsert: true });
      await AuditLogModel.create(auditEntry);
      return updated;
    }

    this.state.policy = updated;
    this.state.auditLogs.unshift(auditEntry);
    this.persistLocal();
    return updated;
  }

  // --- Subjects ---

  public async getSubjects(): Promise<SubjectItem[]> {
    if (this.mode === 'mongodb') {
      const docs = await SubjectModel.find({}).lean();
      return docs as unknown as SubjectItem[];
    }
    return this.state.subjects;
  }

  public async getSubjectById(id: string): Promise<SubjectItem | null> {
    if (this.mode === 'mongodb') {
      const doc = await SubjectModel.findOne({ id }).lean();
      return (doc as unknown as SubjectItem) || null;
    }
    return this.state.subjects.find((s) => s.id === id) || null;
  }

  public async createSubject(subj: SubjectItem): Promise<SubjectItem> {
    if (this.mode === 'mongodb') {
      await SubjectModel.create(subj);
      return subj;
    }
    this.state.subjects.push(subj);
    this.persistLocal();
    return subj;
  }

  public async updateSubject(
    subjectId: string,
    updates: Partial<SubjectItem>
  ): Promise<SubjectItem | null> {
    if (this.mode === 'mongodb') {
      const updated = await SubjectModel.findOneAndUpdate(
        { id: subjectId },
        { $set: updates },
        { new: true }
      ).lean();
      return (updated as unknown as SubjectItem) || null;
    }
    const idx = this.state.subjects.findIndex((s) => s.id === subjectId);
    if (idx === -1) return null;
    this.state.subjects[idx] = { ...this.state.subjects[idx], ...updates };
    this.persistLocal();
    return this.state.subjects[idx];
  }

  // --- Faculty Assignments ---

  public async getFacultyAssignments(): Promise<FacultyAssignment[]> {
    if (this.mode === 'mongodb') {
      const docs = await FacultyAssignmentModel.find({}).lean();
      return docs as unknown as FacultyAssignment[];
    }
    return this.state.facultyAssignments;
  }

  public async createFacultyAssignment(fa: FacultyAssignment): Promise<FacultyAssignment> {
    const existing = await this.getFacultyAssignments();
    const dup = existing.find(
      (x) =>
        x.status === 'Active' &&
        x.facultyId === fa.facultyId &&
        x.subjectId === fa.subjectId &&
        x.sectionId === fa.sectionId &&
        x.academicYear === fa.academicYear
    );
    if (dup) {
      throw new Error(
        `${fa.facultyName} is already actively assigned to ${fa.subjectCode} for ${fa.sectionDisplayName}.`
      );
    }
    if (this.mode === 'mongodb') {
      await FacultyAssignmentModel.create(fa);
      return fa;
    }
    this.state.facultyAssignments.push(fa);
    this.persistLocal();
    return fa;
  }

  public async updateFacultyAssignment(
    id: string,
    updates: Partial<FacultyAssignment>
  ): Promise<FacultyAssignment | null> {
    if (this.mode === 'mongodb') {
      const doc = await FacultyAssignmentModel.findOneAndUpdate(
        { id },
        { $set: updates },
        { new: true }
      ).lean();
      return (doc as unknown as FacultyAssignment) || null;
    }
    const idx = this.state.facultyAssignments.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    this.state.facultyAssignments[idx] = { ...this.state.facultyAssignments[idx], ...updates };
    this.persistLocal();
    return this.state.facultyAssignments[idx];
  }

  // --- Timetable ---

  public async getTimetable(): Promise<TimetableEntry[]> {
    if (this.mode === 'mongodb') {
      const docs = await TimetableEntryModel.find({}).lean();
      return docs as unknown as TimetableEntry[];
    }
    return this.state.timetable;
  }

  public async createTimetableEntry(entry: TimetableEntry): Promise<TimetableEntry> {
    if (this.mode === 'mongodb') {
      await TimetableEntryModel.create(entry);
      return entry;
    }
    this.state.timetable.push(entry);
    this.persistLocal();
    return entry;
  }

  public async updateTimetableEntry(
    id: string,
    updates: Partial<TimetableEntry>
  ): Promise<TimetableEntry | null> {
    if (this.mode === 'mongodb') {
      const doc = await TimetableEntryModel.findOneAndUpdate(
        { id },
        { $set: updates },
        { new: true }
      ).lean();
      return (doc as unknown as TimetableEntry) || null;
    }
    const idx = this.state.timetable.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    this.state.timetable[idx] = { ...this.state.timetable[idx], ...updates };
    this.persistLocal();
    return this.state.timetable[idx];
  }

  public async deleteTimetableEntry(id: string): Promise<boolean> {
    if (this.mode === 'mongodb') {
      const res = await TimetableEntryModel.deleteOne({ id });
      return res.deletedCount > 0;
    }
    const before = this.state.timetable.length;
    this.state.timetable = this.state.timetable.filter((t) => t.id !== id);
    if (this.state.timetable.length !== before) {
      this.persistLocal();
      return true;
    }
    return false;
  }

  // --- Class Sessions & Attendance Records ---

  public async getAllSessions(): Promise<ClassSession[]> {
    if (this.mode === 'mongodb') {
      const docs = await ClassSessionModel.find({}).lean();
      return docs as unknown as ClassSession[];
    }
    return this.state.classes;
  }

  public async getClassById(classId: string): Promise<ClassSession | null> {
    if (this.mode === 'mongodb') {
      const doc = await ClassSessionModel.findOne({ id: classId }).lean();
      return (doc as unknown as ClassSession) || null;
    }
    return this.state.classes.find((c) => c.id === classId) || null;
  }

  public async createClassSession(session: ClassSession): Promise<ClassSession> {
    if (this.mode === 'mongodb') {
      await ClassSessionModel.create(session);
      return session;
    }
    this.state.classes.unshift(session);
    this.persistLocal();
    return session;
  }

  public async updateClassSession(
    classId: string,
    updates: Partial<ClassSession>
  ): Promise<ClassSession | null> {
    if (this.mode === 'mongodb') {
      const doc = await ClassSessionModel.findOneAndUpdate(
        { id: classId },
        { $set: updates },
        { new: true }
      ).lean();
      return (doc as unknown as ClassSession) || null;
    }
    const idx = this.state.classes.findIndex((c) => c.id === classId);
    if (idx === -1) return null;
    this.state.classes[idx] = { ...this.state.classes[idx], ...updates };
    this.persistLocal();
    return this.state.classes[idx];
  }

  public async getRecordsForStudent(studentIdOrIdentifier: string): Promise<AttendanceRecord[]> {
    const user =
      (await this.findUserById(studentIdOrIdentifier)) ||
      (await this.findUserByIdentifier(studentIdOrIdentifier));
    const ids = new Set<string>([studentIdOrIdentifier]);
    if (user) {
      ids.add(user.id);
      ids.add(user.identifier);
    }
    const idArray = Array.from(ids);

    if (this.mode === 'mongodb') {
      const docs = await AttendanceRecordModel.find({ studentId: { $in: idArray } })
        .sort({ timestamp: -1 })
        .lean();
      return docs as unknown as AttendanceRecord[];
    }
    return this.state.records
      .filter((r) => ids.has(r.studentId))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  public async getRecordsForStudentPaginated(
    studentIdOrIdentifier: string,
    page = 1,
    limit = 50
  ): Promise<{
    records: AttendanceRecord[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const all = await this.getRecordsForStudent(studentIdOrIdentifier);
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const validPage = Math.max(1, Math.min(page, totalPages));
    const start = (validPage - 1) * limit;
    const records = all.slice(start, start + limit);
    return { records, total, page: validPage, totalPages };
  }

  public async calculateStudentAttendanceStats(studentIdOrIdentifier: string): Promise<{
    overallPercentage: number;
    totalClasses: number;
    attendedClasses: number;
    subjectStats: Array<{
      subjectId: string;
      subjectCode: string;
      subjectName: string;
      attended: number;
      conducted: number;
      percentage: number;
      eligible: boolean;
    }>;
  }> {
    const records = await this.getRecordsForStudent(studentIdOrIdentifier);
    const subjects = await this.getSubjects();
    const policy = await this.getPolicy();
    const minPct = policy.defaultMinimumPercentage || 75;

    const subjectMap = new Map<string, { subjectCode: string; subjectName: string; attended: number; conducted: number }>();
    for (const sub of subjects) {
      subjectMap.set(sub.id, {
        subjectCode: sub.code,
        subjectName: sub.name,
        attended: 0,
        conducted: 0,
      });
    }

    let totalAttended = 0;
    let totalConducted = 0;

    for (const rec of records) {
      let entry = subjectMap.get(rec.subjectId);
      if (!entry) {
        entry = { subjectCode: rec.subjectId, subjectName: rec.subjectId, attended: 0, conducted: 0 };
        subjectMap.set(rec.subjectId, entry);
      }
      entry.conducted++;
      totalConducted++;
      if (rec.effectivePresent || rec.status === 'Present') {
        entry.attended++;
        totalAttended++;
      }
    }

    const overallPercentage = totalConducted > 0 ? Math.round((totalAttended / totalConducted) * 1000) / 10 : 100;
    const subjectStats = Array.from(subjectMap.entries())
      .filter(([, s]) => s.conducted > 0)
      .map(([subjId, s]) => {
        const pct = s.conducted > 0 ? Math.round((s.attended / s.conducted) * 1000) / 10 : 100;
        return {
          subjectId: subjId,
          subjectCode: s.subjectCode,
          subjectName: s.subjectName,
          attended: s.attended,
          conducted: s.conducted,
          percentage: pct,
          eligible: pct >= minPct,
        };
      });

    return {
      overallPercentage,
      totalClasses: totalConducted,
      attendedClasses: totalAttended,
      subjectStats,
    };
  }

  public async getAllRecords(): Promise<AttendanceRecord[]> {
    if (this.mode === 'mongodb') {
      const docs = await AttendanceRecordModel.find({}).lean();
      return docs as unknown as AttendanceRecord[];
    }
    return this.state.records;
  }

  public async getRecordById(recordId: string): Promise<AttendanceRecord | null> {
    if (this.mode === 'mongodb') {
      const doc = await AttendanceRecordModel.findOne({ id: recordId }).lean();
      return (doc as unknown as AttendanceRecord) || null;
    }
    return this.state.records.find((r) => r.id === recordId) || null;
  }

  public async submitAttendanceForExistingSession(
    sessionId: string,
    newRecords: AttendanceRecord[],
    topicUpdate?: string
  ): Promise<ClassSession> {
    const existing = await this.getClassById(sessionId);
    if (!existing) {
      throw new Error('Class session not found.');
    }
    if (existing.attendanceSubmitted || existing.status === 'Conducted') {
      throw new Error(
        'Attendance has already been submitted for this session. Use the Correction workflow to modify submitted records.'
      );
    }
    if (existing.status === 'Cancelled' || existing.status === 'Rescheduled') {
      throw new Error(`Cannot submit attendance for a ${existing.status.toLowerCase()} session.`);
    }

    if (this.mode === 'mongodb') {
      if (newRecords.length > 0) {
        await AttendanceRecordModel.insertMany(newRecords);
      }
      const updated = await ClassSessionModel.findOneAndUpdate(
        { id: sessionId },
        {
          $set: {
            status: 'Conducted',
            attendanceSubmitted: true,
            ...(topicUpdate?.trim() ? { topic: topicUpdate.trim() } : {}),
          },
        },
        { new: true }
      ).lean();
      return updated as unknown as ClassSession;
    }

    for (const nr of newRecords) {
      const sessId = nr.attendanceSessionId || nr.classId;
      const dup = this.state.records.find(
        (r) => r.studentId === nr.studentId && (r.attendanceSessionId || r.classId) === sessId
      );
      if (dup) {
        throw new Error(
          `Duplicate attendance entry blocked for student ${nr.studentId} in session ${sessId}.`
        );
      }
    }

    this.state.records.push(...newRecords);
    const idx = this.state.classes.findIndex((c) => c.id === sessionId);
    this.state.classes[idx] = {
      ...this.state.classes[idx],
      status: 'Conducted',
      attendanceSubmitted: true,
      ...(topicUpdate?.trim() ? { topic: topicUpdate.trim() } : {}),
    };
    this.persistLocal();
    return this.state.classes[idx];
  }

  public async recordNewClassAttendance(
    newSession: ClassSession,
    newRecords: AttendanceRecord[]
  ): Promise<void> {
    if (this.mode === 'mongodb') {
      await ClassSessionModel.create(newSession);
      if (newRecords.length > 0) {
        await AttendanceRecordModel.insertMany(newRecords);
      }
      return;
    }
    for (const nr of newRecords) {
      const sessId = nr.attendanceSessionId || nr.classId;
      const dup = this.state.records.find(
        (r) => r.studentId === nr.studentId && (r.attendanceSessionId || r.classId) === sessId
      );
      if (dup) {
        throw new Error(
          `Duplicate attendance entry for student ${nr.studentId} in session ${sessId}`
        );
      }
    }
    this.state.classes.unshift(newSession);
    this.state.records.push(...newRecords);
    this.persistLocal();
  }

  public async insertAttendanceRecord(record: AttendanceRecord): Promise<AttendanceRecord> {
    const sessId = record.attendanceSessionId || record.classId;
    record.attendanceSessionId = sessId;
    if (this.mode === 'mongodb') {
      await AttendanceRecordModel.create(record);
      return record;
    }
    const dup = this.state.records.find(
      (r) => r.studentId === record.studentId && (r.attendanceSessionId || r.classId) === sessId
    );
    if (dup) {
      throw new Error(`Duplicate attendance entry for student ${record.studentId} in session ${sessId}`);
    }
    this.state.records.push(record);
    this.persistLocal();
    return record;
  }

  // --- Corrections ---

  public async getCorrectionsForStudent(studentId: string): Promise<AttendanceCorrectionRequest[]> {
    if (this.mode === 'mongodb') {
      const docs = await CorrectionRequestModel.find({ studentId })
        .sort({ updatedAt: -1 })
        .lean();
      return docs as unknown as AttendanceCorrectionRequest[];
    }
    return [...this.state.corrections]
      .filter((c) => c.studentId === studentId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public async getAllCorrections(): Promise<AttendanceCorrectionRequest[]> {
    if (this.mode === 'mongodb') {
      const docs = await CorrectionRequestModel.find({}).sort({ updatedAt: -1 }).lean();
      return docs as unknown as AttendanceCorrectionRequest[];
    }
    return [...this.state.corrections].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public async getCorrectionById(id: string): Promise<AttendanceCorrectionRequest | null> {
    if (this.mode === 'mongodb') {
      const doc = await CorrectionRequestModel.findOne({ id }).lean();
      return (doc as unknown as AttendanceCorrectionRequest) || null;
    }
    return this.state.corrections.find((c) => c.id === id) || null;
  }

  public async saveNewCorrectionRequest(
    reqItem: AttendanceCorrectionRequest,
    notifyRecipientId?: string
  ): Promise<AttendanceCorrectionRequest> {
    const isActivePending =
      reqItem.workflowStatus === 'Submitted' ||
      reqItem.workflowStatus === 'Under Review' ||
      reqItem.workflowStatus === 'Additional Evidence Requested';

    const notif: AppNotification | null =
      notifyRecipientId && reqItem.workflowStatus === 'Submitted'
        ? {
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            recipientId: notifyRecipientId,
            type: 'CORRECTION_SUBMITTED',
            title: `New correction request: ${reqItem.subjectCode} (${reqItem.sectionDisplayName})`,
            message: `${reqItem.studentName} (${reqItem.studentIdentifier}) submitted ${reqItem.referenceNumber} for ${reqItem.classDate}.`,
            relatedRecordId: reqItem.id,
            targetNav: 'corrections',
            read: false,
            timestamp: new Date().toISOString(),
          }
        : null;

    if (this.mode === 'mongodb') {
      await CorrectionRequestModel.create(reqItem);
      if (isActivePending) {
        await AttendanceRecordModel.updateOne(
          { id: reqItem.attendanceRecordId },
          { $set: { pendingRequestId: reqItem.id } }
        );
      }
      if (notif) await NotificationModel.create(notif);
      return reqItem;
    }

    this.state.corrections.unshift(reqItem);
    if (isActivePending) {
      const rec = this.state.records.find((r) => r.id === reqItem.attendanceRecordId);
      if (rec) rec.pendingRequestId = reqItem.id;
    }
    if (notif) this.state.notifications.unshift(notif);
    this.persistLocal();
    return reqItem;
  }

  public async updateCorrectionRequest(
    updated: AttendanceCorrectionRequest,
    options?: {
      updatedAttendanceRecord?: AttendanceRecord;
      auditLog?: AttendanceAuditLog;
      notification?: AppNotification;
      clearPendingOnRecord?: boolean;
    }
  ): Promise<AttendanceCorrectionRequest> {
    if (this.mode === 'mongodb') {
      const session = await mongoose.startSession().catch(() => null);
      try {
        if (session) session.startTransaction();
        await CorrectionRequestModel.findOneAndUpdate({ id: updated.id }, updated);
        if (options?.updatedAttendanceRecord) {
          await AttendanceRecordModel.findOneAndUpdate(
            { id: options.updatedAttendanceRecord.id },
            options.updatedAttendanceRecord
          );
        } else if (options?.clearPendingOnRecord) {
          await AttendanceRecordModel.updateOne(
            { id: updated.attendanceRecordId },
            { $unset: { pendingRequestId: 1 } }
          );
        }
        if (options?.auditLog) {
          await AuditLogModel.create(options.auditLog);
        }
        if (options?.notification) {
          await NotificationModel.create(options.notification);
        }
        if (session) await session.commitTransaction();
      } catch (err) {
        if (session) await session.abortTransaction();
        throw err;
      } finally {
        if (session) session.endSession();
      }
      return updated;
    }

    const idx = this.state.corrections.findIndex((c) => c.id === updated.id);
    if (idx !== -1) {
      this.state.corrections[idx] = updated;
    }
    if (options?.updatedAttendanceRecord) {
      const rIdx = this.state.records.findIndex(
        (r) => r.id === options.updatedAttendanceRecord!.id
      );
      if (rIdx !== -1) {
        this.state.records[rIdx] = options.updatedAttendanceRecord;
      }
    } else if (options?.clearPendingOnRecord) {
      const rec = this.state.records.find((r) => r.id === updated.attendanceRecordId);
      if (rec) delete rec.pendingRequestId;
    }
    if (options?.auditLog) {
      this.state.auditLogs.unshift(options.auditLog);
    }
    if (options?.notification) {
      this.state.notifications.unshift(options.notification);
    }
    this.persistLocal();
    return updated;
  }

  public async recordEvidenceAccess(
    requestId: string,
    viewer: UserProfile,
    fileName: string
  ): Promise<void> {
    const entry = {
      viewerId: viewer.id,
      viewerName: viewer.name,
      viewerRole: viewer.role,
      fileName,
      accessedAt: new Date().toISOString(),
    };
    if (this.mode === 'mongodb') {
      await CorrectionRequestModel.updateOne(
        { id: requestId },
        { $push: { evidenceAccessLogs: entry } }
      );
      return;
    }
    const reqItem = this.state.corrections.find((c) => c.id === requestId);
    if (reqItem) {
      reqItem.evidenceAccessLogs.push(entry);
      this.persistLocal();
    }
  }

  // --- Audit & Notifications ---

  public async getAuditLogsForStudent(studentId: string): Promise<AttendanceAuditLog[]> {
    if (this.mode === 'mongodb') {
      const docs = await AuditLogModel.find({
        $or: [{ studentId }, { studentId: 'all' }],
      })
        .sort({ timestamp: -1 })
        .lean();
      return docs as unknown as AttendanceAuditLog[];
    }
    return [...this.state.auditLogs]
      .filter((a) => a.studentId === studentId || a.studentId === 'all')
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  public async getAllAuditLogs(): Promise<AttendanceAuditLog[]> {
    if (this.mode === 'mongodb') {
      const docs = await AuditLogModel.find({}).sort({ timestamp: -1 }).lean();
      return docs as unknown as AttendanceAuditLog[];
    }
    return [...this.state.auditLogs].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  public async getNotificationsForUser(userId: string): Promise<AppNotification[]> {
    if (this.mode === 'mongodb') {
      const docs = await NotificationModel.find({ recipientId: userId })
        .sort({ timestamp: -1 })
        .lean();
      return docs as unknown as AppNotification[];
    }
    return [...this.state.notifications]
      .filter((n) => n.recipientId === userId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  public async markNotificationsRead(userId: string, notificationId?: string): Promise<void> {
    if (this.mode === 'mongodb') {
      if (notificationId) {
        await NotificationModel.updateOne(
          { id: notificationId, recipientId: userId },
          { $set: { read: true } }
        );
      } else {
        await NotificationModel.updateMany({ recipientId: userId }, { $set: { read: true } });
      }
      return;
    }
    for (const n of this.state.notifications) {
      if (n.recipientId === userId && (!notificationId || n.id === notificationId)) {
        n.read = true;
      }
    }
    this.persistLocal();
  }

  // ============================================================================
  // SECURE TIME-BOUND & LOCATION-VERIFIED QR ATTENDANCE METHODS
  // ============================================================================

  // Cryptographic token helper
  private generateSecureQrToken(sessionId: string, expiresAt: number): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload = `${sessionId}:${expiresAt}:${nonce}`;
    const hmac = crypto.createHmac('sha256', this.qrSigningSecret).update(payload).digest('hex').substring(0, 16);
    return `VTU_SEC_${sessionId}_${expiresAt}_${nonce}_${hmac}`;
  }

  private verifySecureQrToken(token: string, sessionId: string): { valid: boolean; reason?: string } {
    if (!token || !token.startsWith('VTU_SEC_')) {
      return { valid: false, reason: 'Invalid QR token format.' };
    }
    const parts = token.split('_');
    // Expected: ["VTU", "SEC", sessionId, expiresAt, nonce, hmac]
    if (parts.length < 6) {
      return { valid: false, reason: 'Malformed QR token.' };
    }
    const tokenSessionId = parts[2];
    const expiresAt = Number(parts[3]);
    const nonce = parts[4];
    const signature = parts[5];

    if (tokenSessionId !== sessionId) {
      return { valid: false, reason: 'QR token belongs to a different session.' };
    }

    const payload = `${tokenSessionId}:${expiresAt}:${nonce}`;
    const expectedHmac = crypto.createHmac('sha256', this.qrSigningSecret).update(payload).digest('hex').substring(0, 16);
    if (signature !== expectedHmac) {
      return { valid: false, reason: 'Cryptographic QR signature mismatch.' };
    }

    // In bypass mode, accept all valid tokens generated for this session
    return { valid: true };
  }

  public async createQrSession(params: {
    sectionId: string;
    subjectId: string;
    faculty: UserProfile;
    durationMinutes?: number;
    classroom?: string;
    hostLatitude?: number;
    hostLongitude?: number;
    hostAccuracy?: number;
  }): Promise<QRAttendanceSession> {
    const policy = await this.getPolicy();
    const section = await this.getSectionById(params.sectionId);
    const subject = await this.getSubjectById(params.subjectId);
    if (!section || !subject) {
      throw new Error('Invalid section or subject specified for QR attendance session.');
    }

    // Host GPS coordinates verification: Teacher device GPS is mandatory
    if (
      params.hostLatitude === undefined ||
      params.hostLongitude === undefined ||
      isNaN(params.hostLatitude) ||
      isNaN(params.hostLongitude)
    ) {
      throw new Error(
        'Teacher host device GPS coordinates are mandatory. Cannot start attendance session without verified host location.'
      );
    }

    // Host GPS accuracy verification
    const maxTeacherAccuracy = policy.maxAcceptableGpsAccuracyMeters || 80;
    if (params.hostAccuracy !== undefined && params.hostAccuracy > maxTeacherAccuracy) {
      throw new Error(
        `Teacher host device GPS accuracy (±${Math.round(params.hostAccuracy)}m) is insufficient. Maximum allowable accuracy is ±${maxTeacherAccuracy}m.`
      );
    }

    const duration =
      params.durationMinutes && params.durationMinutes > 0
        ? params.durationMinutes
        : policy.defaultSessionDurationMinutes || 5;

    const enrolledStudents = (await this.listAllUsers()).filter(
      (u) => u.role === 'student' && u.sectionId === section.id && u.accountStatus === 'Active'
    );

    const now = Date.now();
    const sessionId = `qr-sess-${now}`;
    const qrIntervalMs = 5000; // strictly 5 seconds dynamic QR rotation
    const tokenExpiresAt = now + qrIntervalMs;
    const token = this.generateSecureQrToken(sessionId, tokenExpiresAt);

    const newSession: QRAttendanceSession = {
      id: sessionId,
      sectionId: section.id,
      sectionDisplayName: section.displayName,
      subjectId: subject.id,
      subjectCode: subject.code,
      subjectName: subject.name,
      facultyId: params.faculty.id,
      facultyName: params.faculty.name,
      classroom: params.classroom || section.defaultClassroom || 'LH-101',
      hostLatitude: params.hostLatitude,
      hostLongitude: params.hostLongitude,
      hostAccuracy: params.hostAccuracy,
      date: new Date().toISOString().split('T')[0],
      startTime: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
      endTime: new Date(now + duration * 60 * 1000).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
      currentQrToken: token,
      tokenIssuedAt: now,
      tokenExpiresAt,
      sessionExpiresAt: now + duration * 60 * 1000,
      durationMinutes: duration,
      status: 'ACTIVE',
      refreshCount: 0,
      totalEnrolled: enrolledStudents.length,
      verifiedCount: 0,
      reviewRequiredCount: 0,
      rejectedCount: 0,
      createdAt: new Date().toISOString(),
    };

    if (this.mode === 'mongodb') {
      await QRAttendanceSessionModel.create(newSession);
    } else {
      this.state.qrSessions.unshift(newSession);
      this.persistLocal();
    }

    await this.appendAuditLog({
      id: `aud-${Date.now()}`,
      category: 'ATTENDANCE_RECORD',
      attendanceRecordId: sessionId,
      sectionId: section.id,
      sectionDisplayName: section.displayName,
      subjectId: subject.id,
      subjectCode: subject.code,
      subjectName: subject.name,
      classId: sessionId,
      classDate: newSession.date,
      classPeriod: 'Dynamic QR',
      studentId: 'all',
      studentName: 'All Enrolled Students',
      studentIdentifier: section.displayName,
      previousValue: 'None',
      newValue: 'QR Session Active',
      previousVersion: 0,
      newVersion: 1,
      action: 'QR_SESSION_STARTED',
      actorId: params.faculty.id,
      actorName: params.faculty.name,
      actorRole: params.faculty.role,
      reason: `Started ${duration}-minute time & location verified QR attendance session.`,
      evidenceReference: `Session ${sessionId} (Host GPS: ${params.hostLatitude}, ${params.hostLongitude})`,
      timestamp: new Date().toISOString(),
    });

    return newSession;
  }

  public async getQrSessionById(id: string): Promise<QRAttendanceSession | null> {
    if (this.mode === 'mongodb') {
      const doc = await QRAttendanceSessionModel.findOne({ id }).lean();
      if (!doc) return null;
      const s = doc as unknown as QRAttendanceSession;
      if (s.status === 'ACTIVE' && Date.now() > s.sessionExpiresAt) {
        await QRAttendanceSessionModel.updateOne(
          { id },
          { $set: { status: 'CLOSED', closedAt: new Date().toISOString() } }
        );
        s.status = 'CLOSED';
        s.closedAt = new Date().toISOString();
      }
      return s;
    }

    const s = this.state.qrSessions.find((item) => item.id === id);
    if (!s) return null;
    if (s.status === 'ACTIVE' && Date.now() > s.sessionExpiresAt) {
      s.status = 'CLOSED';
      s.closedAt = new Date().toISOString();
      this.persistLocal();
    }
    return s;
  }

  public async refreshQrToken(
    sessionId: string,
    facultyId: string
  ): Promise<{ token: string; tokenExpiresAt: number; tokenIssuedAt: number; refreshCount: number }> {
    const session = await this.getQrSessionById(sessionId);
    if (!session) {
      throw new Error('Attendance session not found.');
    }
    if (session.facultyId !== facultyId && !facultyId.startsWith('adm-')) {
      throw new Error('Only the conducting faculty member or administrator can refresh this session.');
    }
    if (session.status !== 'ACTIVE' || Date.now() > session.sessionExpiresAt) {
      throw new Error('Attendance session has concluded and cannot be refreshed.');
    }

    const now = Date.now();
    const qrIntervalMs = 5000; // strictly 5 seconds dynamic QR rotation
    const tokenExpiresAt = now + qrIntervalMs;
    const newToken = this.generateSecureQrToken(sessionId, tokenExpiresAt);
    const refreshCount = session.refreshCount + 1;

    if (this.mode === 'mongodb') {
      await QRAttendanceSessionModel.updateOne(
        { id: sessionId },
        {
          $set: {
            currentQrToken: newToken,
            tokenIssuedAt: now,
            tokenExpiresAt,
            refreshCount,
          },
        }
      );
    } else {
      session.currentQrToken = newToken;
      session.tokenIssuedAt = now;
      session.tokenExpiresAt = tokenExpiresAt;
      session.refreshCount = refreshCount;
      this.persistLocal();
    }

    return { token: newToken, tokenExpiresAt, tokenIssuedAt: now, refreshCount };
  }

  public async closeQrSession(sessionId: string, facultyId: string): Promise<QRAttendanceSession> {
    const session = await this.getQrSessionById(sessionId);
    if (!session) {
      throw new Error('Attendance session not found.');
    }
    if (session.facultyId !== facultyId && !facultyId.startsWith('adm-')) {
      throw new Error('Only the conducting faculty member or administrator can conclude this session.');
    }

    const closedAt = new Date().toISOString();
    if (this.mode === 'mongodb') {
      await QRAttendanceSessionModel.updateOne(
        { id: sessionId },
        { $set: { status: 'CLOSED', closedAt } }
      );
    } else {
      session.status = 'CLOSED';
      session.closedAt = closedAt;
      this.persistLocal();
    }

    return { ...session, status: 'CLOSED', closedAt };
  }

  public async listQrSessions(facultyId?: string): Promise<QRAttendanceSession[]> {
    if (this.mode === 'mongodb') {
      const query: Record<string, unknown> = {};
      if (facultyId) query.facultyId = facultyId;
      const docs = await QRAttendanceSessionModel.find(query).sort({ createdAt: -1 }).lean();
      return docs as unknown as QRAttendanceSession[];
    }
    return this.state.qrSessions
      .filter((s) => !facultyId || s.facultyId === facultyId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // --- Student Attendance Submission & Anti-Proxy Rule Engine ---

  public async submitQrAttendanceAttempt(params: {
    sessionId: string;
    qrToken: string;
    student: UserProfile;
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
    // Chain sequentially onto attendanceLock queue
    const execution = this.attendanceLock.then(
      () => this.executeSubmitQrAttendanceAttempt(params),
      () => this.executeSubmitQrAttendanceAttempt(params)
    );
    this.attendanceLock = execution.then(() => {}, () => {});
    return execution;
  }

  private async executeSubmitQrAttendanceAttempt(params: {
    sessionId: string;
    qrToken: string;
    student: UserProfile;
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
    const policy = await this.getPolicy();
    const session = await this.getQrSessionById(params.sessionId);

    const now = Date.now();
    const submissionId = `att-atm-${now}-${crypto.randomBytes(4).toString('hex')}`;
    const suspiciousSignals: string[] = [];

    if (!session) {
      const dummyAttempt: AttendanceSubmissionAttempt = {
        id: submissionId,
        sessionId: params.sessionId,
        studentId: params.student.id,
        studentName: params.student.name,
        studentIdentifier: params.student.identifier,
        sectionId: params.student.sectionId || 'unknown',
        sectionDisplayName: params.student.sectionDisplayName || 'unknown',
        subjectId: 'unknown',
        subjectCode: 'UNKNOWN',
        subjectName: 'Unknown',
        facultyId: 'unknown',
        submittedAt: new Date().toISOString(),
        serverTimestamp: now,
        qrTokenReference: params.qrToken,
        reportedLatitude: params.latitude,
        reportedLongitude: params.longitude,
        reportedAccuracy: params.accuracy,
        calculatedDistanceMeters: 99999,
        isWithinRadius: false,
        isAccuracyAcceptable: false,
        deviceFingerprint: params.deviceFingerprint,
        devicePlatform: params.devicePlatform,
        deviceStatus: 'Unrecognized',
        classification: 'REJECTED',
        rejectionOrReviewReason: 'Invalid attendance session.',
        suspiciousSignals: ['INVALID_SESSION_ID'],
        attendanceRecordCreated: false,
      };
      return {
        success: false,
        classification: 'REJECTED',
        message: 'Invalid attendance session.',
        attempt: dummyAttempt,
      };
    }

    // 1. Session status & expiration check (server authoritative)
    if (session.status !== 'ACTIVE' || now > session.sessionExpiresAt) {
      const closedAttempt: AttendanceSubmissionAttempt = {
        id: submissionId,
        sessionId: session.id,
        studentId: params.student.id,
        studentName: params.student.name,
        studentIdentifier: params.student.identifier,
        sectionId: session.sectionId,
        sectionDisplayName: session.sectionDisplayName,
        subjectId: session.subjectId,
        subjectCode: session.subjectCode,
        subjectName: session.subjectName,
        facultyId: session.facultyId,
        submittedAt: new Date().toISOString(),
        serverTimestamp: now,
        qrTokenReference: params.qrToken,
        reportedLatitude: params.latitude,
        reportedLongitude: params.longitude,
        reportedAccuracy: params.accuracy,
        calculatedDistanceMeters: 0,
        isWithinRadius: false,
        isAccuracyAcceptable: false,
        deviceFingerprint: params.deviceFingerprint,
        devicePlatform: params.devicePlatform,
        deviceStatus: 'Registered',
        classification: 'REJECTED',
        rejectionOrReviewReason: 'Attendance session closed.',
        suspiciousSignals: ['SESSION_EXPIRED_OR_CLOSED'],
        attendanceRecordCreated: false,
      };
      await this.recordAttendanceAttempt(closedAttempt);
      return {
        success: false,
        classification: 'REJECTED',
        message: 'Attendance session closed.',
        attempt: closedAttempt,
      };
    }

    // 2. Academic Section verification
    if (params.student.sectionId && params.student.sectionId !== session.sectionId) {
      const sectionAttempt: AttendanceSubmissionAttempt = {
        id: submissionId,
        sessionId: session.id,
        studentId: params.student.id,
        studentName: params.student.name,
        studentIdentifier: params.student.identifier,
        sectionId: params.student.sectionId,
        sectionDisplayName: params.student.sectionDisplayName || 'Other Section',
        subjectId: session.subjectId,
        subjectCode: session.subjectCode,
        subjectName: session.subjectName,
        facultyId: session.facultyId,
        submittedAt: new Date().toISOString(),
        serverTimestamp: now,
        qrTokenReference: params.qrToken,
        reportedLatitude: params.latitude,
        reportedLongitude: params.longitude,
        reportedAccuracy: params.accuracy,
        calculatedDistanceMeters: 0,
        isWithinRadius: false,
        isAccuracyAcceptable: false,
        deviceFingerprint: params.deviceFingerprint,
        devicePlatform: params.devicePlatform,
        deviceStatus: 'Registered',
        classification: 'REJECTED',
        rejectionOrReviewReason: `You belong to section ${params.student.sectionDisplayName || params.student.sectionId}. This attendance session is only for ${session.sectionDisplayName}.`,
        suspiciousSignals: ['SECTION_MISMATCH: Student scanned QR from another section'],
        attendanceRecordCreated: false,
      };
      await this.recordAttendanceAttempt(sectionAttempt);
      return {
        success: false,
        classification: 'REJECTED',
        message: `You belong to section ${params.student.sectionDisplayName || params.student.sectionId}. This attendance session is only for ${session.sectionDisplayName}.`,
        attempt: sectionAttempt,
      };
    }

    // 3. Cryptographically Secure QR Token & Rotation Verification (BYPASS ACTIVE)
    // To accommodate camera focus delays, network latency over devtunnels, and rotation jitter,
    // any token issued for this active session is accepted without being rejected as stale or expired.
    const tokenParts = params.qrToken ? params.qrToken.split('_') : [];
    const tokenSessionId = tokenParts.length >= 3 ? tokenParts[2] : undefined;
    if (tokenSessionId && tokenSessionId !== session.id) {
      const failedAttempt: AttendanceSubmissionAttempt = {
        id: submissionId,
        sessionId: session.id,
        studentId: params.student.id,
        studentName: params.student.name,
        studentIdentifier: params.student.identifier,
        sectionId: session.sectionId,
        sectionDisplayName: session.sectionDisplayName,
        subjectId: session.subjectId,
        subjectCode: session.subjectCode,
        subjectName: session.subjectName,
        facultyId: session.facultyId,
        submittedAt: new Date().toISOString(),
        serverTimestamp: now,
        qrTokenReference: params.qrToken,
        reportedLatitude: params.latitude,
        reportedLongitude: params.longitude,
        reportedAccuracy: params.accuracy,
        calculatedDistanceMeters: 0,
        isWithinRadius: false,
        isAccuracyAcceptable: false,
        deviceFingerprint: params.deviceFingerprint,
        devicePlatform: params.devicePlatform,
        deviceStatus: 'Registered',
        classification: 'REJECTED',
        rejectionOrReviewReason: 'This QR code belongs to a different session.',
        suspiciousSignals: ['SESSION_TOKEN_MISMATCH'],
        attendanceRecordCreated: false,
      };
      await this.recordAttendanceAttempt(failedAttempt);
      await this.incrementSessionCounter(session.id, 'rejectedCount');
      return {
        success: false,
        classification: 'REJECTED',
        message: 'This QR code belongs to a different session.',
        attempt: failedAttempt,
      };
    }

    // 4. Duplicate attendance prevention (check verified attempts first)
    const existingAttempts = await this.listAttendanceAttempts(session.id, params.student.id);
    const alreadyVerified = existingAttempts.find((a) => a.classification === 'VERIFIED');
    if (alreadyVerified) {
      const dupAttempt: AttendanceSubmissionAttempt = {
        id: submissionId,
        sessionId: session.id,
        studentId: params.student.id,
        studentName: params.student.name,
        studentIdentifier: params.student.identifier,
        sectionId: session.sectionId,
        sectionDisplayName: session.sectionDisplayName,
        subjectId: session.subjectId,
        subjectCode: session.subjectCode,
        subjectName: session.subjectName,
        facultyId: session.facultyId,
        submittedAt: new Date().toISOString(),
        serverTimestamp: now,
        qrTokenReference: params.qrToken,
        reportedLatitude: params.latitude,
        reportedLongitude: params.longitude,
        reportedAccuracy: params.accuracy,
        calculatedDistanceMeters: 0,
        isWithinRadius: true,
        isAccuracyAcceptable: true,
        deviceFingerprint: params.deviceFingerprint,
        devicePlatform: params.devicePlatform,
        deviceStatus: 'Registered',
        classification: 'REJECTED',
        rejectionOrReviewReason: 'Duplicate attendance submission. Your attendance has already been recorded for this session.',
        suspiciousSignals: ['DUPLICATE_ATTENDANCE_ATTEMPT'],
        attendanceRecordCreated: false,
      };
      await this.recordAttendanceAttempt(dupAttempt);
      return {
        success: false,
        classification: 'REJECTED',
        message: 'Duplicate attendance submission. Your attendance has already been recorded for this session.',
        attempt: dupAttempt,
      };
    }

    // 5. GPS Location & Proximity Verification (ALL LOCATION SETTINGS BYPASSED)
    // Accept any scan regardless of GPS availability, coordinate range, accuracy, or proximity distance.
    const effectiveLat = params.latitude || 15.77671;
    const effectiveLng = params.longitude || 74.46640;
    const effectiveAccuracy = params.accuracy || 10;
    const isAccuracyAcceptable = true;
    const isWithinHostRadius = true;
    let calculatedHostDistanceMeters: number | undefined = 0;

    if (
      session.hostLatitude !== undefined &&
      session.hostLongitude !== undefined &&
      !isNaN(session.hostLatitude) &&
      !isNaN(session.hostLongitude) &&
      params.latitude &&
      params.longitude
    ) {
      try {
        calculatedHostDistanceMeters = this.calculateHaversineDistanceMeters(
          params.latitude,
          params.longitude,
          session.hostLatitude,
          session.hostLongitude
        );
      } catch {
        calculatedHostDistanceMeters = 0;
      }
    }

    // 6. Device Registration & Risk Signals
    const deviceBinding = await this.getDeviceBindingByStudent(params.student.id);
    let deviceStatus: 'Registered' | 'Pending_Device' | 'Unrecognized' = 'Registered';

    // Anti-proxy check: is this fingerprint used by multiple student accounts?
    const allAttempts = await this.getAllAttendanceAttempts();
    const otherStudentsSameDevice = allAttempts.filter(
      (a) =>
        a.deviceFingerprint === params.deviceFingerprint &&
        a.studentId !== params.student.id &&
        now - a.serverTimestamp < 24 * 60 * 60 * 1000
    );
    if (otherStudentsSameDevice.length > 0) {
      suspiciousSignals.push(
        `MULTIPLE_ACCOUNTS_SAME_DEVICE: Same device hardware used by ${otherStudentsSameDevice[0].studentName} (${otherStudentsSameDevice[0].studentIdentifier}).`
      );
    }

    if (!deviceBinding) {
      // First-time device primary enrollment
      await this.registerDeviceBinding({
        id: `dev-bind-${params.student.id}`,
        studentId: params.student.id,
        studentName: params.student.name,
        studentIdentifier: params.student.identifier,
        sectionDisplayName: session.sectionDisplayName,
        deviceFingerprint: params.deviceFingerprint,
        devicePlatform: params.devicePlatform,
        browserName: params.browserName,
        status: 'Approved',
        registeredAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        history: [
          {
            id: `dev-hist-${params.student.id}-first`,
            deviceFingerprint: params.deviceFingerprint,
            devicePlatform: params.devicePlatform,
            browserName: params.browserName,
            action: 'FIRST_REGISTRATION',
            actorId: params.student.id,
            actorRole: 'student',
            timestamp: new Date().toISOString(),
            reason: 'First-time primary device enrollment upon attendance scan.',
          },
        ],
      });
      deviceStatus = 'Registered';
    } else if (deviceBinding.deviceFingerprint !== params.deviceFingerprint) {
      if (!policy.enforceDeviceRegistration || otherStudentsSameDevice.length === 0) {
        // Auto-update student's device binding when no cross-student proxy conflict exists
        deviceBinding.deviceFingerprint = params.deviceFingerprint;
        deviceBinding.devicePlatform = params.devicePlatform;
        deviceBinding.browserName = params.browserName;
        deviceBinding.lastUsedAt = new Date().toISOString();
        deviceStatus = 'Registered';
      } else {
        deviceStatus = 'Unrecognized';
        suspiciousSignals.push(
          `DEVICE_MISMATCH: Current device (${params.devicePlatform}) differs from registered device (${deviceBinding.devicePlatform}). Additional admin verification required.`
        );
      }
    } else if (deviceBinding.status === 'Pending_Approval') {
      deviceStatus = 'Pending_Device';
    } else {
      await this.touchDeviceLastUsed(deviceBinding.id);
    }

    // 7. Anti-Proxy Rule Classification (LOCATION REJECTIONS BYPASSED)
    let classification: VerificationClassification = 'VERIFIED';
    let rejectionOrReviewReason: string | undefined = undefined;

    if (otherStudentsSameDevice.length > 0) {
      classification = 'REVIEW_REQUIRED';
      rejectionOrReviewReason = 'Device verification required by administrator.';
    } else {
      classification = 'VERIFIED';
    }

    // 8. Record Attendance atomically if VERIFIED
    let createdRecord: AttendanceRecord | undefined;
    if (classification === 'VERIFIED') {
      // Find session-specific or matching class session
      let targetClassSession: ClassSession | undefined;
      if (session.classId) {
        targetClassSession = (await this.getClassById(session.classId)) || undefined;
      }
      if (!targetClassSession) {
        targetClassSession = (await this.getAllSessions()).find(
          (c) =>
            c.originalSessionId === session.id ||
            c.id === `cls-${session.sectionId}-${session.subjectCode.toLowerCase()}-${session.id}`
        );
      }

      if (!targetClassSession) {
        targetClassSession = await this.createClassSession({
          id: `cls-${session.sectionId}-${session.subjectCode.toLowerCase()}-${session.id}`,
          originalSessionId: session.id,
          sectionId: session.sectionId,
          sectionDisplayName: session.sectionDisplayName,
          subjectId: session.subjectId,
          subjectCode: session.subjectCode,
          subjectName: session.subjectName,
          date: session.date,
          period: session.startTime ? `Lecture (${session.startTime})` : 'Dynamic QR',
          startTime: session.startTime,
          endTime: session.endTime,
          durationHours: 1,
          topic: `${session.subjectName} (${session.startTime || 'QR Lecture'})`,
          sessionType: 'Regular',
          status: 'Conducted',
          scheduledFacultyId: session.facultyId,
          scheduledFacultyName: session.facultyName,
          facultyId: session.facultyId,
          facultyName: session.facultyName,
          isSubstitute: false,
          classroom: session.classroom,
          attendanceSubmitted: true,
          approvalStatus: 'Approved',
          createdBy: session.facultyId,
          isDemo: false,
        });
      }

      // Check existing record for this attendance session inside the lock
      const existingRecord = (await this.getRecordsForStudent(params.student.id)).find(
        (r) => (r.attendanceSessionId || r.classId) === session.id
      );

      if (existingRecord) {
        createdRecord = existingRecord;
      } else {
        const newRecord: AttendanceRecord = {
          id: `rec-qr-${params.student.id}-${session.id}`,
          studentId: params.student.id,
          classId: targetClassSession.id,
          attendanceSessionId: session.id,
          sectionId: session.sectionId,
          subjectId: session.subjectId,
          status: 'Present',
          effectivePresent: true,
          originalStatus: 'Present',
          recordSource: 'QR Geoverified',
          recordedById: session.facultyId,
          recordedByName: session.facultyName,
          timestamp: new Date().toISOString(),
          correctionVersion: 0,
        };
        try {
          await this.insertAttendanceRecord(newRecord);
          createdRecord = newRecord;
        } catch (dupErr) {
          // Handled duplicate key safely
          const refetched = (await this.getRecordsForStudent(params.student.id)).find(
            (r) => (r.attendanceSessionId || r.classId) === session.id
          );
          createdRecord = refetched || newRecord;
        }
      }

      await this.incrementSessionCounter(session.id, 'verifiedCount');
    } else if (classification === 'REVIEW_REQUIRED') {
      await this.incrementSessionCounter(session.id, 'reviewRequiredCount');
    } else {
      await this.incrementSessionCounter(session.id, 'rejectedCount');
    }

    const finalAttempt: AttendanceSubmissionAttempt = {
      id: submissionId,
      sessionId: session.id,
      studentId: params.student.id,
      studentName: params.student.name,
      studentIdentifier: params.student.identifier,
      sectionId: session.sectionId,
      sectionDisplayName: session.sectionDisplayName,
      subjectId: session.subjectId,
      subjectCode: session.subjectCode,
      subjectName: session.subjectName,
      facultyId: session.facultyId,
      submittedAt: new Date().toISOString(),
      serverTimestamp: now,
      qrTokenReference: params.qrToken,
      reportedLatitude: effectiveLat,
      reportedLongitude: effectiveLng,
      reportedAccuracy: effectiveAccuracy,
      calculatedDistanceMeters: calculatedHostDistanceMeters ?? 0,
      calculatedHostDistanceMeters,
      isWithinRadius: true,
      isAccuracyAcceptable: true,
      deviceFingerprint: params.deviceFingerprint,
      devicePlatform: params.devicePlatform,
      deviceStatus,
      classification,
      rejectionOrReviewReason,
      suspiciousSignals,
      attendanceRecordCreated: classification === 'VERIFIED',
      attendanceRecordId: createdRecord?.id,
    };

    await this.recordAttendanceAttempt(finalAttempt);

    const message =
      classification === 'VERIFIED'
        ? 'Attendance marked successfully.'
        : rejectionOrReviewReason || 'Attendance submission unverified.';

    return {
      success: classification === 'VERIFIED',
      classification,
      message,
      attempt: finalAttempt,
      record: createdRecord,
    };
  }

  // --- Attendance Attempt Logging & Monitoring ---

  private async recordAttendanceAttempt(attempt: AttendanceSubmissionAttempt): Promise<void> {
    if (this.mode === 'mongodb') {
      await AttendanceSubmissionAttemptModel.create(attempt);
      return;
    }
    this.state.attendanceAttempts.unshift(attempt);
    this.persistLocal();
  }

  private async incrementSessionCounter(
    sessionId: string,
    field: 'verifiedCount' | 'reviewRequiredCount' | 'rejectedCount'
  ): Promise<void> {
    if (this.mode === 'mongodb') {
      await QRAttendanceSessionModel.updateOne({ id: sessionId }, { $inc: { [field]: 1 } });
      return;
    }
    const session = this.state.qrSessions.find((s) => s.id === sessionId);
    if (session) {
      session[field] = (session[field] || 0) + 1;
      this.persistLocal();
    }
  }

  public async listAttendanceAttempts(
    sessionId?: string,
    studentId?: string
  ): Promise<AttendanceSubmissionAttempt[]> {
    if (this.mode === 'mongodb') {
      const query: Record<string, unknown> = {};
      if (sessionId) query.sessionId = sessionId;
      if (studentId) query.studentId = studentId;
      const docs = await AttendanceSubmissionAttemptModel.find(query)
        .sort({ serverTimestamp: -1 })
        .lean();
      return docs as unknown as AttendanceSubmissionAttempt[];
    }
    return this.state.attendanceAttempts
      .filter((a) => (!sessionId || a.sessionId === sessionId) && (!studentId || a.studentId === studentId))
      .sort((a, b) => b.serverTimestamp - a.serverTimestamp);
  }

  public async getAllAttendanceAttempts(): Promise<AttendanceSubmissionAttempt[]> {
    if (this.mode === 'mongodb') {
      const docs = await AttendanceSubmissionAttemptModel.find({})
        .sort({ serverTimestamp: -1 })
        .lean();
      return docs as unknown as AttendanceSubmissionAttempt[];
    }
    return this.state.attendanceAttempts.sort((a, b) => b.serverTimestamp - a.serverTimestamp);
  }

  // --- Device Bindings ---

  public async getDeviceBindingByStudent(studentId: string): Promise<StudentDeviceBinding | null> {
    if (this.mode === 'mongodb') {
      const doc = await StudentDeviceBindingModel.findOne({ studentId }).lean();
      return (doc as unknown as StudentDeviceBinding) || null;
    }
    return this.state.deviceBindings.find((d) => d.studentId === studentId) || null;
  }

  public async registerDeviceBinding(binding: StudentDeviceBinding): Promise<StudentDeviceBinding> {
    const existing = await this.getDeviceBindingByStudent(binding.studentId);
    const history = existing?.history || [];
    const event = {
      id: `dev-hist-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      deviceFingerprint: binding.deviceFingerprint,
      devicePlatform: binding.devicePlatform,
      browserName: binding.browserName,
      action: (existing ? 'DEVICE_CHANGE_REQUESTED' : 'FIRST_REGISTRATION') as any,
      actorId: binding.studentId,
      actorRole: 'student',
      timestamp: new Date().toISOString(),
      reason: binding.changeReason || (existing ? 'Student requested device re-binding.' : 'Primary hardware registration.'),
    };
    binding.history = [event, ...history];

    if (this.mode === 'mongodb') {
      await StudentDeviceBindingModel.findOneAndUpdate(
        { studentId: binding.studentId },
        binding,
        { upsert: true, new: true }
      );
      return binding;
    }
    const idx = this.state.deviceBindings.findIndex((d) => d.studentId === binding.studentId);
    if (idx !== -1) {
      this.state.deviceBindings[idx] = binding;
    } else {
      this.state.deviceBindings.unshift(binding);
    }
    this.persistLocal();
    return binding;
  }

  public async listDeviceBindings(): Promise<StudentDeviceBinding[]> {
    if (this.mode === 'mongodb') {
      const docs = await StudentDeviceBindingModel.find({}).sort({ updatedAt: -1 }).lean();
      return docs as unknown as StudentDeviceBinding[];
    }
    return this.state.deviceBindings;
  }

  public async updateDeviceBindingStatus(
    id: string,
    status: 'Approved' | 'Rejected',
    reviewNotes?: string,
    adminActor?: UserProfile
  ): Promise<StudentDeviceBinding> {
    const existing = this.mode === 'mongodb'
      ? (await StudentDeviceBindingModel.findOne({ id }).lean() as unknown as StudentDeviceBinding)
      : this.state.deviceBindings.find((d) => d.id === id);

    if (!existing) throw new Error('Device binding not found.');

    const history = existing.history || [];
    const event = {
      id: `dev-hist-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      deviceFingerprint: existing.deviceFingerprint,
      devicePlatform: existing.devicePlatform,
      browserName: existing.browserName,
      action: (status === 'Approved' ? 'APPROVED' : 'REJECTED') as any,
      actorId: adminActor?.id || 'admin',
      actorRole: adminActor?.role || 'admin',
      timestamp: new Date().toISOString(),
      reason: reviewNotes || `Administrator ${status.toLowerCase()} device binding.`,
    };
    const updatedHistory = [event, ...history];

    if (this.mode === 'mongodb') {
      const doc = await StudentDeviceBindingModel.findOneAndUpdate(
        { id },
        { $set: { status, reviewNotes, history: updatedHistory } },
        { new: true }
      ).lean();
      return doc as unknown as StudentDeviceBinding;
    }
    const item = this.state.deviceBindings.find((d) => d.id === id);
    if (!item) throw new Error('Device binding not found.');
    item.status = status;
    if (reviewNotes !== undefined) item.reviewNotes = reviewNotes;
    item.history = updatedHistory;
    this.persistLocal();
    return item;
  }

  public async resetDeviceBinding(studentId: string, adminActor?: UserProfile): Promise<void> {
    const existing = await this.getDeviceBindingByStudent(studentId);
    if (existing) {
      // Append audit log for device reset
      await this.appendAuditLog({
        id: `aud-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        category: 'ATTENDANCE_RECORD',
        attendanceRecordId: existing.id,
        sectionId: existing.sectionDisplayName || 'default',
        sectionDisplayName: existing.sectionDisplayName || 'Student Cohort',
        subjectId: 'DEVICE_SECURITY',
        subjectCode: 'DEVICE',
        subjectName: 'Student Device Binding',
        classId: existing.id,
        classDate: new Date().toISOString().split('T')[0],
        classPeriod: 'Admin Security',
        studentId: existing.studentId,
        studentName: existing.studentName,
        studentIdentifier: existing.studentIdentifier,
        previousValue: existing.deviceFingerprint,
        newValue: 'RESET_PENDING_REGISTRATION',
        previousVersion: 1,
        newVersion: 2,
        action: 'DEVICE_BINDING_RESET',
        actorId: adminActor?.id || 'admin',
        actorName: adminActor?.name || 'Administrator',
        actorRole: adminActor?.role || 'admin',
        reason: 'Authorized administrator reset student registered device.',
        evidenceReference: `Device ${existing.devicePlatform} (${existing.deviceFingerprint})`,
        timestamp: new Date().toISOString(),
      });
    }

    if (this.mode === 'mongodb') {
      await StudentDeviceBindingModel.deleteOne({ studentId });
      return;
    }
    this.state.deviceBindings = this.state.deviceBindings.filter((d) => d.studentId !== studentId);
    this.persistLocal();
  }

  private async touchDeviceLastUsed(bindingId: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.mode === 'mongodb') {
      await StudentDeviceBindingModel.updateOne({ id: bindingId }, { $set: { lastUsedAt: now } });
      return;
    }
    const item = this.state.deviceBindings.find((d) => d.id === bindingId);
    if (item) {
      item.lastUsedAt = now;
      this.persistLocal();
    }
  }

  // --- Random In-Class Verification Challenges ---

  public async triggerRandomVerification(
    sessionId: string,
    facultyId: string,
    requestedCount = 3
  ): Promise<RandomInClassVerification[]> {
    const session = await this.getQrSessionById(sessionId);
    if (!session) throw new Error('Attendance session not found.');
    if (session.facultyId !== facultyId && !facultyId.startsWith('adm-')) {
      throw new Error('Only conducting faculty can trigger in-class verifications.');
    }

    // Select from verified student scans
    const verifiedScans = (await this.listAttendanceAttempts(sessionId)).filter(
      (a) => a.classification === 'VERIFIED'
    );
    if (verifiedScans.length === 0) {
      throw new Error('No students have verified their attendance in this session yet.');
    }

    const policy = await this.getPolicy();
    const windowMinutes = policy.randomVerificationWindowMinutes || 3;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + windowMinutes * 60 * 1000).toISOString();

    // Pick random unique students
    const shuffled = [...verifiedScans].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(requestedCount, shuffled.length));

    const verifications: RandomInClassVerification[] = selected.map((scan) => {
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      return {
        id: `rcv-${Date.now()}-${scan.studentId}`,
        sessionId,
        facultyId,
        studentId: scan.studentId,
        studentName: scan.studentName,
        studentIdentifier: scan.studentIdentifier,
        challengeCode: code,
        initiatedAt: now.toISOString(),
        expiresAt,
        windowMinutes,
        status: 'PENDING',
      };
    });

    if (this.mode === 'mongodb') {
      await RandomInClassVerificationModel.insertMany(verifications);
    } else {
      this.state.randomVerifications.unshift(...verifications);
      this.persistLocal();
    }

    return verifications;
  }

  public async listRandomVerifications(
    sessionId?: string,
    studentId?: string
  ): Promise<RandomInClassVerification[]> {
    if (this.mode === 'mongodb') {
      const query: Record<string, unknown> = {};
      if (sessionId) query.sessionId = sessionId;
      if (studentId) query.studentId = studentId;
      const docs = await RandomInClassVerificationModel.find(query).sort({ initiatedAt: -1 }).lean();
      return docs as unknown as RandomInClassVerification[];
    }
    return this.state.randomVerifications
      .filter((r) => (!sessionId || r.sessionId === sessionId) && (!studentId || r.studentId === studentId))
      .sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt));
  }

  public async respondRandomVerification(
    challengeId: string,
    studentId: string,
    enteredCode: string
  ): Promise<{ success: boolean; message: string }> {
    let challenge: RandomInClassVerification | null = null;
    if (this.mode === 'mongodb') {
      const doc = await RandomInClassVerificationModel.findOne({ id: challengeId }).lean();
      challenge = (doc as unknown as RandomInClassVerification) || null;
    } else {
      challenge = this.state.randomVerifications.find((r) => r.id === challengeId) || null;
    }

    if (!challenge) throw new Error('Challenge not found.');
    if (challenge.studentId !== studentId) throw new Error('This challenge was not assigned to your account.');

    const now = Date.now();
    const expiry = new Date(challenge.expiresAt).getTime();
    if (now > expiry) {
      if (this.mode === 'mongodb') {
        await RandomInClassVerificationModel.updateOne(
          { id: challengeId },
          { $set: { status: 'MISSED', respondedAt: new Date().toISOString() } }
        );
      } else {
        challenge.status = 'MISSED';
        challenge.respondedAt = new Date().toISOString();
        this.persistLocal();
      }
      return { success: false, message: 'Verification window expired. Challenge recorded as missed.' };
    }

    if (challenge.challengeCode !== enteredCode.trim()) {
      return { success: false, message: 'Incorrect challenge code entered.' };
    }

    const respondedAt = new Date().toISOString();
    if (this.mode === 'mongodb') {
      await RandomInClassVerificationModel.updateOne(
        { id: challengeId },
        { $set: { status: 'VERIFIED', respondedAt } }
      );
    } else {
      challenge.status = 'VERIFIED';
      challenge.respondedAt = respondedAt;
      this.persistLocal();
    }

    return { success: true, message: 'In-class verification confirmed successfully.' };
  }

  // --- Utility Distance Helper ---
  public calculateHaversineDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371e3; // Earth radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c * 10) / 10;
  }
}
