import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { StoredUser } from './server/seedData.ts';
import { DataRepository } from './server/store.ts';
import {
  validateSessionConflicts,
  validateTimetableEntryConflicts,
} from './src/shared/conflictCheck.ts';
import {
  AcademicSection,
  AppNotification,
  AttendanceAuditLog,
  AttendanceCorrectionRequest,
  AttendanceRecord,
  ClassSession,
  ClassSessionStatus,
  ClassSessionType,
  CorrectionWorkflowStatus,
  EvidenceFileMeta,
  FacultyAssignment,
  FacultyUnavailabilitySlot,
  SubjectItem,
  TimetableEntry,
  UserProfile,
  UserRole,
} from './src/shared/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const JWT_SECRET =
  process.env.JWT_SECRET?.trim() || 'vtu-smart-attendance-institutional-secret-2026';
const PRIVATE_UPLOAD_DIR = path.resolve(
  __dirname,
  process.env.PRIVATE_UPLOAD_DIR?.trim() || '.private_uploads'
);
const LOCAL_DB_PATH = path.resolve(__dirname, '.local_db', 'vtu_attendance_store.json');

const repo = new DataRepository(LOCAL_DB_PATH, PRIVATE_UPLOAD_DIR);

interface AuthenticatedRequest extends Request {
  user?: UserProfile;
}

function signSessionToken(user: UserProfile): string {
  return jwt.sign(
    { sub: user.id, role: user.role, identifier: user.identifier },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function setSessionCookie(res: Response, token: string): void {
  const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.APP_URL);
  res.cookie('vtu_auth_cookie_v3', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

async function extractUserFromRequest(req: Request): Promise<UserProfile | null> {
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.cookies?.vtu_auth_cookie_v3) {
    token = req.cookies.vtu_auth_cookie_v3;
  }
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string };
    const stored = await repo.findUserById(decoded.sub);
    if (!stored || stored.accountStatus !== 'Active') return null;
    return repo.toPublicUser(stored);
  } catch {
    return null;
  }
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  extractUserFromRequest(req)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: 'Authentication required. Please sign in.' });
        return;
      }
      req.user = user;
      next();
    })
    .catch(() => {
      res.status(500).json({ error: 'Failed to verify authentication session.' });
    });
}

function requireRoles(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Access denied. Your institutional role is not authorized for this action.',
      });
      return;
    }
    next();
  };
}

function isFacultyAuthorizedForPair(
  facultyId: string,
  sectionId: string,
  subjectId: string,
  assignments: FacultyAssignment[],
  session?: ClassSession | null
): boolean {
  if (
    session &&
    (session.facultyId === facultyId || session.scheduledFacultyId === facultyId)
  ) {
    return true;
  }
  return assignments.some(
    (a) =>
      a.status === 'Active' &&
      a.facultyId === facultyId &&
      a.sectionId === sectionId &&
      a.subjectId === subjectId
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BulkStudentCsvRowInput {
  rowNumber?: number;
  name?: string;
  usn?: string;
  email?: string;
  department?: string;
  section?: string;
  semester?: number | string;
  academicYear?: string;
  rollNumber?: string;
  accountStatus?: string;
}

async function validateBulkStudentRows(rawRows: BulkStudentCsvRowInput[]) {
  const sections = await repo.getSections();
  const allUsers = await repo.listAllUsers();
  const existingIdentifiers = new Set(allUsers.map((u) => u.identifier.toLowerCase()));
  const existingEmails = new Set(allUsers.map((u) => u.email.toLowerCase()));
  const seenCsvIdentifiers = new Set<string>();
  const seenCsvEmails = new Set<string>();

  const validRows: Array<{
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
  }> = [];

  const duplicateRows: Array<{
    rowNumber: number;
    usn: string;
    email: string;
    name: string;
    reason: string;
  }> = [];

  const invalidRows: Array<{
    rowNumber: number;
    usn: string;
    email: string;
    name: string;
    reason: string;
  }> = [];

  rawRows.forEach((raw, idx) => {
    const rowNum = Number(raw.rowNumber) || idx + 1;
    const name = String(raw.name || '').trim();
    const usn = String(raw.usn || '')
      .trim()
      .toUpperCase();
    const email = String(raw.email || '')
      .trim()
      .toLowerCase();
    const department = String(raw.department || '')
      .trim()
      .toUpperCase();
    const rawSec = String(raw.section || '')
      .trim()
      .toUpperCase();
    const semNum = Number(raw.semester);
    const academicYear = String(raw.academicYear || '2026-27').trim();
    const rollNumber = String(raw.rollNumber || '').trim();
    const statusClean: 'Active' | 'Inactive' =
      String(raw.accountStatus || 'Active').trim().toLowerCase() === 'inactive'
        ? 'Inactive'
        : 'Active';

    if (!name || !usn || !email || !department || !rawSec || !academicYear) {
      invalidRows.push({
        rowNumber: rowNum,
        usn,
        email,
        name,
        reason: 'Missing one or more required fields (name, usn, email, department, section, academicYear).',
      });
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      invalidRows.push({
        rowNumber: rowNum,
        usn,
        email,
        name,
        reason: `Invalid email address format ("${email}").`,
      });
      return;
    }

    if (Number.isNaN(semNum) || semNum < 1 || semNum > 8) {
      invalidRows.push({
        rowNumber: rowNum,
        usn,
        email,
        name,
        reason: `Invalid semester "${raw.semester}" (must be 1–8).`,
      });
      return;
    }

    // Match section either by (department + sectionName) or displayName (e.g., "CSE A")
    const matchedSection = sections.find(
      (s) =>
        s.status === 'Active' &&
        ((s.department.toUpperCase() === department &&
          s.sectionName.toUpperCase() === rawSec) ||
          s.displayName.toUpperCase() === rawSec ||
          s.displayName.toUpperCase() === `${department} ${rawSec}`)
    );

    if (!matchedSection) {
      invalidRows.push({
        rowNumber: rowNum,
        usn,
        email,
        name,
        reason: `Academic section "${department} ${rawSec}" does not exist. Create the section in Departments & Sections first.`,
      });
      return;
    }

    const usnKey = usn.toLowerCase();
    if (existingIdentifiers.has(usnKey)) {
      duplicateRows.push({
        rowNumber: rowNum,
        usn,
        email,
        name,
        reason: `USN ${usn} already exists in the institution database.`,
      });
      return;
    }
    if (existingEmails.has(email)) {
      duplicateRows.push({
        rowNumber: rowNum,
        usn,
        email,
        name,
        reason: `Email ${email} already exists in the institution database.`,
      });
      return;
    }
    if (seenCsvIdentifiers.has(usnKey)) {
      duplicateRows.push({
        rowNumber: rowNum,
        usn,
        email,
        name,
        reason: `Duplicate USN ${usn} repeated inside the uploaded CSV file.`,
      });
      return;
    }
    if (seenCsvEmails.has(email)) {
      duplicateRows.push({
        rowNumber: rowNum,
        usn,
        email,
        name,
        reason: `Duplicate email ${email} repeated inside the uploaded CSV file.`,
      });
      return;
    }

    seenCsvIdentifiers.add(usnKey);
    seenCsvEmails.add(email);

    validRows.push({
      rowNumber: rowNum,
      name,
      usn,
      email,
      department: matchedSection.department,
      sectionName: matchedSection.sectionName,
      sectionId: matchedSection.id,
      sectionDisplayName: matchedSection.displayName,
      programme: matchedSection.programme,
      semester: semNum,
      academicYear,
      rollNumber,
      accountStatus: statusClean,
    });
  });

  return { validRows, duplicateRows, invalidRows };
}

// Configure Multer for private server-side evidence storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(PRIVATE_UPLOAD_DIR)) {
      fs.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });
    }
    cb(null, PRIVATE_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const safeName = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${ext || '.pdf'}`;
    cb(null, safeName);
  },
});

const ALLOWED_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error('Only PDF, JPEG, and PNG supporting documents (up to 5 MB) are permitted.'));
      return;
    }
    cb(null, true);
  },
});

async function startServer(): Promise<void> {
  await repo.initialize();

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  // Health & Environment Info
  app.get('/api/meta', async (_req: Request, res: Response) => {
    const personas = await repo.listDemoPersonas();
    const policy = await repo.getPolicy();
    const sections = await repo.getSections();
    res.json({
      storageMode: repo.getStorageMode(),
      mongoConfigured: Boolean(process.env.MONGODB_URI?.trim()),
      demoPersonas: personas,
      sections: sections.filter((s) => s.status === 'Active'),
      institutionName: policy.institutionName,
      academicYear: policy.academicYear,
    });
  });

  app.get('/api/auth/me', async (req: Request, res: Response) => {
    const user = await extractUserFromRequest(req);
    const personas = await repo.listDemoPersonas();
    res.json({
      user,
      storageMode: repo.getStorageMode(),
      demoPersonas: personas,
    });
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const { identifierOrEmail, password } = req.body as {
      identifierOrEmail?: string;
      password?: string;
    };

    if (!identifierOrEmail || !password) {
      res.status(400).json({ error: 'Please enter both your USN/ID (or email) and password.' });
      return;
    }

    const found = await repo.findUserByLogin(identifierOrEmail);
    if (!found) {
      res.status(401).json({ error: 'Invalid credentials. Check your USN/ID and password.' });
      return;
    }
    if (found.accountStatus !== 'Active') {
      res.status(403).json({
        error: `This account is currently ${found.accountStatus.toLowerCase()}. Contact Academic Affairs.`,
      });
      return;
    }

    const valid = await bcrypt.compare(password, found.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials. Check your USN/ID and password.' });
      return;
    }

    const publicUser = repo.toPublicUser(found);
    const token = signSessionToken(publicUser);
    setSessionCookie(res, token);
    res.json({ user: publicUser, token });
  });

  app.post('/api/auth/demo-switch', async (req: Request, res: Response) => {
    const { userId } = req.body as { userId?: string };
    if (!userId) {
      res.status(400).json({ error: 'Demonstration persona ID is required.' });
      return;
    }
    const found = await repo.findUserById(userId);
    if (!found || !found.isDemo) {
      res.status(404).json({ error: 'Selected demonstration profile was not found.' });
      return;
    }
    if (found.accountStatus !== 'Active') {
      res.status(403).json({ error: 'Selected demonstration account is currently inactive.' });
      return;
    }
    const publicUser = repo.toPublicUser(found);
    const token = signSessionToken(publicUser);
    setSessionCookie(res, token);
    res.json({ user: publicUser, token });
  });

  app.post('/api/auth/register', async (req: Request, res: Response) => {
    const { name, identifier, email, password, college, programme, semester, sectionId } =
      req.body as {
        name?: string;
        identifier?: string;
        email?: string;
        password?: string;
        college?: string;
        programme?: string;
        semester?: number;
        sectionId?: string;
      };

    if (!name?.trim() || !identifier?.trim() || !email?.trim() || !password || password.length < 8) {
      res.status(400).json({
        error: 'Name, USN, college email, and a password of at least 8 characters are required.',
      });
      return;
    }

    const existingEmail = await repo.findUserByLogin(email);
    const existingId = await repo.findUserByLogin(identifier);
    if (existingEmail || existingId) {
      res.status(409).json({
        error: 'An account with this USN or email address is already registered.',
      });
      return;
    }

    const chosenSec = sectionId ? await repo.getSectionById(sectionId) : null;
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await repo.createUser({
      id: `usr-${Date.now()}`,
      name: name.trim(),
      identifier: identifier.trim().toUpperCase(),
      email: email.trim().toLowerCase(),
      passwordHash,
      role: 'student',
      college: college?.trim() || 'Affiliated Engineering College',
      department: chosenSec?.department || 'CSE',
      programme: chosenSec?.programme || programme?.trim() || 'B.E. Computer Science & Engineering',
      semester: chosenSec?.semester || Number(semester) || 5,
      section: chosenSec?.sectionName || 'A',
      sectionId: chosenSec ? chosenSec.id : undefined,
      sectionDisplayName: chosenSec ? chosenSec.displayName : undefined,
      academicYear: '2026-27',
      accountStatus: 'Active',
      isDemo: false,
    });

    const token = signSessionToken(created);
    setSessionCookie(res, token);
    res.status(201).json({ user: created, token });
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    res.clearCookie('vtu_auth_cookie_v3', { path: '/' });
    res.clearCookie('vtu_session_token', { path: '/' });
    res.json({ ok: true });
  });

  // ============================================================================
  // ROLE- AND SECTION-ISOLATED BOOTSTRAP ENDPOINT
  // ============================================================================
  app.get('/api/bootstrap', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const policy = await repo.getPolicy();
    const allSections = await repo.getSections();
    const allSubjects = await repo.getSubjects();
    const allAssignments = await repo.getFacultyAssignments();
    const allSessions = await repo.getAllSessions();
    const allTimetable = await repo.getTimetable();
    const notifications = await repo.getNotificationsForUser(user.id);

    if (user.role === 'student') {
      // Strictly enforce section isolation on the server:
      // Student sees ONLY their assigned section's timetable, active subjects, and sessions,
      // plus any historical sessions where they personally have a preserved AttendanceRecord.
      const myRecords = await repo.getRecordsForStudent(user.id);
      const historicalClassIds = new Set(myRecords.map((r) => r.classId));
      const historicalSubjectIds = new Set(myRecords.map((r) => r.subjectId));
      const historicalSectionIds = new Set(myRecords.map((r) => r.sectionId));

      const mySectionId = user.sectionId || '';
      const visibleSections = allSections.filter(
        (s) => s.id === mySectionId || historicalSectionIds.has(s.id)
      );

      const sectionAssignments = mySectionId
        ? allAssignments.filter((a) => a.sectionId === mySectionId && a.status === 'Active')
        : [];
      const assignedSubjectIds = new Set(sectionAssignments.map((a) => a.subjectId));

      // Map subject coordinator display to the section's assigned faculty so CSE B sees its CSE B teacher!
      const facBySubjForSection = new Map<string, { id: string; name: string }>();
      for (const fa of sectionAssignments) {
        facBySubjForSection.set(fa.subjectId, { id: fa.facultyId, name: fa.facultyName });
      }

      const visibleSubjects = allSubjects
        .filter((s) => assignedSubjectIds.has(s.id) || historicalSubjectIds.has(s.id))
        .map((s) => {
          const override = facBySubjForSection.get(s.id);
          return override
            ? { ...s, assignedFacultyId: override.id, assignedFacultyName: override.name }
            : s;
        });

      const visibleClasses = allSessions.filter(
        (c) =>
          (mySectionId && c.sectionId === mySectionId && c.approvalStatus === 'Approved') ||
          historicalClassIds.has(c.id)
      );

      const visibleTimetable = mySectionId
        ? allTimetable.filter((t) => t.sectionId === mySectionId && t.status === 'Active')
        : [];

      const corrections = await repo.getCorrectionsForStudent(user.id);
      const auditLogs = await repo.getAuditLogsForStudent(user.id);

      const allQrSessions = await repo.listQrSessions();
      const activeQrSessions = allQrSessions
        .filter(
          (s) => s.status === 'ACTIVE' && s.sectionId === mySectionId && Date.now() <= s.sessionExpiresAt
        )
        .map((s) => ({
          ...s,
          currentQrToken: '', // Token is strictly never exposed in student bootstrap JSON
        }));
      const deviceBinding = await repo.getDeviceBindingByStudent(user.id);
      const studentChallenges = (await repo.listRandomVerifications(undefined, user.id)).filter(
        (c) => c.status === 'PENDING' && new Date(c.expiresAt).getTime() > Date.now()
      );

      res.json({
        user,
        policy,
        storageMode: repo.getStorageMode(),
        sections: visibleSections,
        subjects: visibleSubjects,
        facultyAssignments: sectionAssignments,
        classes: visibleClasses,
        records: myRecords,
        corrections,
        auditLogs,
        timetable: visibleTimetable,
        notifications,
        cohortUsers: [],
        facultyDirectory: [],
        activeQrSessions,
        qrSessions: activeQrSessions,
        deviceBinding,
        pendingRandomChallenges: studentChallenges,
      });
      return;
    }

    if (user.role === 'faculty') {
      // Faculty sees ONLY their assigned (section, subject) combinations + substitute sessions!
      const myAssignments = allAssignments.filter(
        (a) => a.facultyId === user.id && a.status === 'Active'
      );
      const assignedPairKeys = new Set(
        myAssignments.map((a) => `${a.sectionId}::${a.subjectId}`)
      );

      const visibleClasses = allSessions.filter(
        (c) =>
          c.facultyId === user.id ||
          c.scheduledFacultyId === user.id ||
          assignedPairKeys.has(`${c.sectionId}::${c.subjectId}`)
      );

      const authorizedSectionIds = new Set<string>(myAssignments.map((a) => a.sectionId));
      const authorizedSubjectIds = new Set<string>(myAssignments.map((a) => a.subjectId));
      for (const c of visibleClasses) {
        if (c.approvalStatus !== 'Rejected') {
          authorizedSectionIds.add(c.sectionId);
          authorizedSubjectIds.add(c.subjectId);
        }
      }
      for (const s of allSubjects) {
        if (s.assignedFacultyId === user.id) {
          authorizedSubjectIds.add(s.id);
        }
      }

      const visibleSections = allSections.filter((s) => authorizedSectionIds.has(s.id));
      const visibleSubjects = allSubjects.filter((s) => authorizedSubjectIds.has(s.id));
      const visibleClassIds = new Set(visibleClasses.map((c) => c.id));

      const allRecords = await repo.getAllRecords();
      const visibleRecords = allRecords.filter(
        (r) =>
          visibleClassIds.has(r.classId) ||
          assignedPairKeys.has(`${r.sectionId}::${r.subjectId}`)
      );

      const allUsers = await repo.listAllUsers();
      const studentIdsWithRecords = new Set(visibleRecords.map((r) => r.studentId));
      const authorizedStudents = allUsers.filter(
        (u) =>
          u.role === 'student' &&
          ((u.sectionId && authorizedSectionIds.has(u.sectionId)) ||
            studentIdsWithRecords.has(u.id))
      );

      const facultyDirectory = allUsers.filter(
        (u) => u.role === 'faculty' && u.accountStatus === 'Active'
      );

      const allCorrections = await repo.getAllCorrections();
      const visibleCorrections = allCorrections.filter((c) => {
        const cls = allSessions.find((s) => s.id === c.classId);
        return isFacultyAuthorizedForPair(
          user.id,
          c.sectionId,
          c.subjectId,
          myAssignments,
          cls
        );
      });

      const allAudits = await repo.getAllAuditLogs();
      const visibleAudits = allAudits.filter(
        (a) =>
          a.actorId === user.id ||
          visibleClassIds.has(a.classId) ||
          (a.sectionId && assignedPairKeys.has(`${a.sectionId}::${a.subjectId}`))
      );

      const visibleTimetable = allTimetable.filter(
        (t) => t.facultyId === user.id && t.status === 'Active'
      );

      const facultyQrSessions = await repo.listQrSessions(user.id);
      const activeQrSessions = facultyQrSessions.filter(
        (s) => s.status === 'ACTIVE' && Date.now() <= s.sessionExpiresAt
      );
      const facultyChallenges = await repo.listRandomVerifications();

      res.json({
        user,
        policy,
        storageMode: repo.getStorageMode(),
        sections: visibleSections,
        subjects: visibleSubjects,
        facultyAssignments: myAssignments,
        classes: visibleClasses,
        records: visibleRecords,
        corrections: visibleCorrections,
        auditLogs: visibleAudits,
        timetable: visibleTimetable,
        notifications,
        cohortUsers: authorizedStudents,
        facultyDirectory,
        qrSessions: facultyQrSessions,
        activeQrSessions,
        pendingRandomChallenges: facultyChallenges.filter((c) => c.facultyId === user.id),
      });
      return;
    }

    // Administrator: Full Institutional Dataset
    const allRecords = await repo.getAllRecords();
    const allCorrections = await repo.getAllCorrections();
    const allAudits = await repo.getAllAuditLogs();
    const allUsers = await repo.listAllUsers();
    const facultyDirectory = allUsers.filter((u) => u.role === 'faculty');
    const allQrSessions = await repo.listQrSessions();
    const allDeviceBindings = await repo.listDeviceBindings();
    const allAttempts = await repo.getAllAttendanceAttempts();

    res.json({
      user,
      policy,
      storageMode: repo.getStorageMode(),
      sections: allSections,
      subjects: allSubjects,
      facultyAssignments: allAssignments,
      classes: allSessions,
      records: allRecords,
      corrections: allCorrections,
      auditLogs: allAudits,
      timetable: allTimetable,
      notifications,
      cohortUsers: allUsers,
      facultyDirectory,
      qrSessions: allQrSessions,
      activeQrSessions: allQrSessions.filter((s) => s.status === 'ACTIVE'),
      deviceBindings: allDeviceBindings,
      attendanceAttempts: allAttempts,
    });
  });

  // ============================================================================
  // FACULTY ATTENDANCE SUBMISSION (SCHEDULED/EXTRA/SUBSTITUTE + NEW SESSIONS)
  // ============================================================================

  // Submit attendance for an existing Scheduled / Confirmed session (Regular, Extra, Replacement, or Substitute)
  app.post(
    '/api/faculty/sessions/:id/attendance',
    requireAuth,
    requireRoles('faculty', 'admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const actor = req.user!;
      const session = await repo.getClassById(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'Scheduled class session was not found.' });
        return;
      }

      if (session.approvalStatus !== 'Approved') {
        res.status(400).json({
          error: `Cannot mark attendance while session approval status is "${session.approvalStatus}".`,
        });
        return;
      }

      if (session.attendanceSubmitted || session.status === 'Conducted') {
        res.status(409).json({
          error:
            'Attendance has already been submitted for this class session. Use the Correction workflow to modify submitted entries.',
        });
        return;
      }

      if (session.status === 'Cancelled' || session.status === 'Rescheduled') {
        res.status(400).json({
          error: `Cannot mark attendance for a ${session.status.toLowerCase()} class session.`,
        });
        return;
      }

      const assignments = await repo.getFacultyAssignments();
      if (
        actor.role === 'faculty' &&
        !isFacultyAuthorizedForPair(
          actor.id,
          session.sectionId,
          session.subjectId,
          assignments,
          session
        )
      ) {
        res.status(403).json({
          error:
            'Access denied. You are not assigned to this academic section and subject or authorized as its substitute faculty.',
        });
        return;
      }

      const { attendance, topic } = req.body as {
        attendance?: Array<{ studentId: string; status: 'Present' | 'Absent' | 'Excused' }>;
        topic?: string;
      };

      if (!Array.isArray(attendance) || attendance.length === 0) {
        res.status(400).json({
          error: 'Student attendance roll entries are required before submitting.',
        });
        return;
      }

      const allUsers = await repo.listAllUsers();
      const sectionStudentIds = new Set(
        allUsers
          .filter(
            (u) =>
              u.role === 'student' &&
              u.sectionId === session.sectionId &&
              u.accountStatus === 'Active'
          )
          .map((u) => u.id)
      );

      for (const entry of attendance) {
        if (!sectionStudentIds.has(entry.studentId)) {
          res.status(400).json({
            error: `Student ${entry.studentId} does not belong to active section ${session.sectionDisplayName}.`,
          });
          return;
        }
      }

      const now = new Date().toISOString();
      const newRecords: AttendanceRecord[] = attendance.map((entry) => ({
        id: `rec-${entry.studentId}-${session.id}`,
        studentId: entry.studentId,
        classId: session.id,
        sectionId: session.sectionId,
        subjectId: session.subjectId,
        status: entry.status,
        effectivePresent: entry.status !== 'Absent',
        originalStatus: entry.status,
        recordSource: 'Faculty Register',
        recordedById: actor.id,
        recordedByName: actor.name,
        timestamp: now,
        correctionVersion: 0,
      }));

      try {
        const updatedSession = await repo.submitAttendanceForExistingSession(
          session.id,
          newRecords,
          topic
        );

        const presentCount = newRecords.filter((r) => r.status === 'Present').length;
        const absentCount = newRecords.filter((r) => r.status === 'Absent').length;
        const excusedCount = newRecords.filter((r) => r.status === 'Excused').length;

        await repo.appendAuditLog({
          id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          category: 'ATTENDANCE_RECORD',
          attendanceRecordId: session.id,
          sectionId: session.sectionId,
          sectionDisplayName: session.sectionDisplayName,
          subjectId: session.subjectId,
          subjectCode: session.subjectCode || 'SUBJECT',
          subjectName: session.subjectName || session.topic,
          classId: session.id,
          classDate: session.date,
          classPeriod: session.period,
          studentId: 'section-roll',
          studentName: `${session.sectionDisplayName} Cohort (${newRecords.length} students)`,
          studentIdentifier: session.sectionDisplayName,
          previousValue: 'Pending Submission',
          newValue: `Submitted (${presentCount} Present, ${absentCount} Absent${excusedCount ? `, ${excusedCount} Excused` : ''})`,
          previousVersion: 0,
          newVersion: 1,
          action: session.isSubstitute
            ? 'SUBSTITUTE_ATTENDANCE_SUBMITTED'
            : 'SESSION_ATTENDANCE_SUBMITTED',
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: `Official class register submitted for ${session.sectionDisplayName} — ${session.subjectCode || ''}.`,
          evidenceReference: `Session ${session.id} (${session.sessionType})`,
          timestamp: now,
        });

        res.json({ session: updatedSession, recordsCreated: newRecords.length });
      } catch (err) {
        res.status(409).json({
          error: err instanceof Error ? err.message : 'Unable to submit class attendance.',
        });
      }
    }
  );

  // Create and immediately record a new class session for an authorized (sectionId, subjectId)
  app.post(
    '/api/faculty/classes',
    requireAuth,
    requireRoles('faculty', 'admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const actor = req.user!;
      const {
        sectionId,
        subjectId,
        date,
        period,
        startTime,
        endTime,
        topic,
        classroom,
        status,
        attendance,
      } = req.body as {
        sectionId?: string;
        subjectId?: string;
        date?: string;
        period?: string;
        startTime?: string;
        endTime?: string;
        topic?: string;
        classroom?: string;
        status?: 'Conducted' | 'Cancelled';
        attendance?: Array<{ studentId: string; status: 'Present' | 'Absent' | 'Excused' }>;
      };

      if (!sectionId || !subjectId || !date || !topic?.trim()) {
        res.status(400).json({
          error: 'Academic section, subject, class date, and lecture topic are required.',
        });
        return;
      }

      const sec = await repo.getSectionById(sectionId);
      const subjects = await repo.getSubjects();
      const subj = subjects.find((s) => s.id === subjectId);
      if (!sec || !subj) {
        res.status(404).json({ error: 'Selected academic section or subject was not found.' });
        return;
      }

      const assignments = await repo.getFacultyAssignments();
      if (
        actor.role === 'faculty' &&
        !isFacultyAuthorizedForPair(actor.id, sec.id, subj.id, assignments)
      ) {
        res.status(403).json({
          error: `You are not assigned to teach ${subj.code} for section ${sec.displayName}.`,
        });
        return;
      }

      // Guard against duplicate conducted session on exact same section, subject, date, and period
      const existingSessions = await repo.getAllSessions();
      const normPeriod = period?.trim() || 'Period 1 (09:00 - 09:55)';
      const dupSession = existingSessions.find(
        (s) =>
          s.sectionId === sec.id &&
          s.subjectId === subj.id &&
          s.date === date &&
          s.period === normPeriod &&
          s.status === 'Conducted'
      );
      if (dupSession) {
        res.status(409).json({
          error: `Attendance has already been submitted for ${sec.displayName} — ${subj.code} on ${date} (${normPeriod}).`,
        });
        return;
      }

      const matchingAssign = assignments.find(
        (a) => a.status === 'Active' && a.sectionId === sec.id && a.subjectId === subj.id
      );
      const scheduledFacId = matchingAssign?.facultyId || subj.assignedFacultyId;
      const scheduledFacName = matchingAssign?.facultyName || subj.assignedFacultyName;
      const actualFacId = actor.role === 'faculty' ? actor.id : scheduledFacId;
      const actualFacName = actor.role === 'faculty' ? actor.name : scheduledFacName;

      const classId = `cls-${sec.id}-${subj.code.toLowerCase()}-${Date.now()}`;
      const sessionStatus: ClassSessionStatus = status === 'Cancelled' ? 'Cancelled' : 'Conducted';
      const now = new Date().toISOString();

      const newSession: ClassSession = {
        id: classId,
        sectionId: sec.id,
        sectionDisplayName: sec.displayName,
        subjectId: subj.id,
        subjectCode: subj.code,
        subjectName: subj.name,
        date,
        period: normPeriod,
        startTime: startTime || '09:00',
        endTime: endTime || '09:55',
        durationHours: 1,
        topic: topic.trim(),
        sessionType: 'Regular',
        status: sessionStatus,
        scheduledFacultyId: scheduledFacId,
        scheduledFacultyName: scheduledFacName,
        facultyId: actualFacId,
        facultyName: actualFacName,
        isSubstitute: actualFacId !== scheduledFacId,
        classroom: classroom?.trim() || sec.defaultClassroom || 'LH-302',
        attendanceSubmitted: sessionStatus === 'Conducted',
        approvalStatus: 'Approved',
        createdBy: actor.id,
        isDemo: sec.isDemo || subj.isDemo,
      };

      const allUsers = await repo.listAllUsers();
      const sectionStudentIds = new Set(
        allUsers
          .filter((u) => u.role === 'student' && u.sectionId === sec.id)
          .map((u) => u.id)
      );

      const newRecords: AttendanceRecord[] =
        sessionStatus === 'Conducted' && Array.isArray(attendance)
          ? attendance
              .filter((entry) => sectionStudentIds.has(entry.studentId))
              .map((entry) => ({
                id: `rec-${entry.studentId}-${classId}`,
                studentId: entry.studentId,
                classId,
                sectionId: sec.id,
                subjectId: subj.id,
                status: entry.status,
                effectivePresent: entry.status !== 'Absent',
                originalStatus: entry.status,
                recordSource: 'Faculty Register',
                recordedById: actor.id,
                recordedByName: actor.name,
                timestamp: now,
                correctionVersion: 0,
              }))
          : [];

      try {
        await repo.recordNewClassAttendance(newSession, newRecords);
        await repo.appendAuditLog({
          id: `aud-${Date.now()}`,
          category: 'ATTENDANCE_RECORD',
          attendanceRecordId: classId,
          sectionId: sec.id,
          sectionDisplayName: sec.displayName,
          subjectId: subj.id,
          subjectCode: subj.code,
          subjectName: subj.name,
          classId,
          classDate: date,
          classPeriod: normPeriod,
          studentId: 'section-roll',
          studentName: `${sec.displayName} Cohort`,
          studentIdentifier: sec.displayName,
          previousValue: 'Unrecorded',
          newValue:
            sessionStatus === 'Cancelled'
              ? 'Cancelled Session'
              : `Conducted (${newRecords.length} student records)`,
          previousVersion: 0,
          newVersion: 1,
          action: 'CLASS_REGISTER_RECORDED',
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: `Recorded ${sessionStatus.toLowerCase()} session for ${sec.displayName} — ${subj.code}.`,
          evidenceReference: 'Faculty Class Register',
          timestamp: now,
        });
        res.status(201).json({ session: newSession, recordsCreated: newRecords.length });
      } catch (err) {
        res.status(409).json({
          error: err instanceof Error ? err.message : 'Failed to save class attendance.',
        });
      }
    }
  );

  // ============================================================================
  // EXTRA CLASSES, RESCHEDULING, CANCELLATIONS & SUBSTITUTE FACULTY
  // ============================================================================

  app.post(
    '/api/extra-classes',
    requireAuth,
    requireRoles('faculty', 'admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const actor = req.user!;
      const policy = await repo.getPolicy();

      if (actor.role === 'faculty' && !policy.allowFacultyExtraClassRequests) {
        res.status(403).json({
          error:
            'Extra class requests by faculty are currently disabled by institutional policy. Contact an administrator.',
        });
        return;
      }

      const {
        sectionId,
        subjectId,
        sessionType,
        date,
        period,
        startTime,
        endTime,
        durationHours,
        classroom,
        topic,
        actualFacultyId,
        originalSessionId,
        markOriginalAs,
        reason,
        notes,
        autoApprove,
      } = req.body as {
        sectionId?: string;
        subjectId?: string;
        sessionType?: ClassSessionType;
        date?: string;
        period?: string;
        startTime?: string;
        endTime?: string;
        durationHours?: number;
        classroom?: string;
        topic?: string;
        actualFacultyId?: string;
        originalSessionId?: string;
        markOriginalAs?: 'Rescheduled' | 'Cancelled';
        reason?: string;
        notes?: string;
        autoApprove?: boolean;
      };

      if (!sectionId || !subjectId || !date || !startTime || !endTime || !reason?.trim()) {
        res.status(400).json({
          error:
            'Section, subject, date, start/end time, and scheduling reason are required.',
        });
        return;
      }

      const sec = await repo.getSectionById(sectionId);
      const subjects = await repo.getSubjects();
      const subj = subjects.find((s) => s.id === subjectId);
      if (!sec || !subj) {
        res.status(404).json({ error: 'Selected section or subject was not found.' });
        return;
      }

      const assignments = await repo.getFacultyAssignments();
      if (
        actor.role === 'faculty' &&
        !isFacultyAuthorizedForPair(actor.id, sec.id, subj.id, assignments)
      ) {
        res.status(403).json({
          error: `Faculty may only request extra or replacement classes for their assigned sections (${sec.displayName} — ${subj.code}).`,
        });
        return;
      }

      const matchingAssign = assignments.find(
        (a) => a.status === 'Active' && a.sectionId === sec.id && a.subjectId === subj.id
      );
      const scheduledFacId = matchingAssign?.facultyId || subj.assignedFacultyId;
      const scheduledFacName = matchingAssign?.facultyName || subj.assignedFacultyName;

      const conductingId = actualFacultyId || (actor.role === 'faculty' ? actor.id : scheduledFacId);
      const conductingStored = await repo.findUserById(conductingId);
      if (!conductingStored || conductingStored.role !== 'faculty' || conductingStored.accountStatus !== 'Active') {
        res.status(400).json({
          error: 'Selected conducting or substitute faculty member must be an active faculty account.',
        });
        return;
      }
      const conductingUser = repo.toPublicUser(conductingStored);

      const existingSessions = await repo.getAllSessions();
      const existingTimetable = await repo.getTimetable();
      const roomClean = classroom?.trim() || sec.defaultClassroom || 'LH-301';

      const conflicts = validateSessionConflicts({
        candidate: {
          sectionId: sec.id,
          date,
          startTime,
          endTime,
          classroom: roomClean,
          actualFacultyId: conductingUser.id,
          originalSessionId: originalSessionId || undefined,
        },
        existingSessions,
        existingTimetable,
        facultyUser: conductingUser,
        checkRooms: policy.enforceRoomConflictCheck,
      });

      if (conflicts.length > 0) {
        res.status(409).json({
          error: conflicts[0].message,
          conflicts,
        });
        return;
      }

      const typeClean: ClassSessionType =
        sessionType && ['Extra', 'Replacement', 'Swapped', 'Regular'].includes(sessionType)
          ? sessionType
          : originalSessionId
            ? 'Replacement'
            : 'Extra';

      const isApproved = actor.role === 'admin';
      const approvalStatus: ClassSession['approvalStatus'] = isApproved
        ? 'Approved'
        : 'Pending Approval';

      const newId = `cls-${typeClean.toLowerCase()}-${Date.now()}`;
      const periodLabel = period?.trim() || `Extra Slot (${startTime} - ${endTime})`;
      const isSub = conductingUser.id !== scheduledFacId;

      const createdSession: ClassSession = {
        id: newId,
        sectionId: sec.id,
        sectionDisplayName: sec.displayName,
        subjectId: subj.id,
        subjectCode: subj.code,
        subjectName: subj.name,
        originalSessionId: originalSessionId || undefined,
        date,
        period: periodLabel,
        startTime,
        endTime,
        durationHours: Math.max(0.5, Number(durationHours) || 1),
        topic: topic?.trim() || `${typeClean} Class — ${subj.name}`,
        sessionType: typeClean,
        status: isApproved ? 'Confirmed' : 'Scheduled',
        scheduledFacultyId: scheduledFacId,
        scheduledFacultyName: scheduledFacName,
        facultyId: conductingUser.id,
        facultyName: conductingUser.name,
        isSubstitute: isSub,
        classroom: roomClean,
        attendanceSubmitted: false,
        extraClassReason: reason.trim(),
        notes: notes?.trim() || '',
        approvalStatus,
        createdBy: actor.id,
        isDemo: sec.isDemo || subj.isDemo,
      };

      await repo.createClassSession(createdSession);

      // Link original session if approved immediately
      if (isApproved && originalSessionId) {
        const orig = await repo.getClassById(originalSessionId);
        if (orig) {
          const origTargetStatus = markOriginalAs === 'Cancelled' ? 'Cancelled' : 'Rescheduled';
          await repo.updateClassSession(orig.id, {
            status: origTargetStatus,
            replacementSessionId: createdSession.id,
            ...(origTargetStatus === 'Cancelled'
              ? { cancellationReason: reason.trim() }
              : { rescheduleReason: reason.trim() }),
            updatedBy: actor.id,
          });
          if (orig.timetableEntryId) {
            const tt = existingTimetable.find((t) => t.id === orig.timetableEntryId);
            if (tt && tt.upcomingDate === orig.date) {
              await repo.updateTimetableEntry(tt.id, { upcomingStatus: origTargetStatus });
            }
          }
        }
      }

      const now = new Date().toISOString();
      const allUsers = await repo.listAllUsers();

      if (isApproved) {
        const sectionStudents = allUsers.filter(
          (u) => u.role === 'student' && u.sectionId === sec.id && u.accountStatus === 'Active'
        );
        const notifs: AppNotification[] = sectionStudents.map((stu) => ({
          id: `notif-${Date.now()}-${stu.id}`,
          recipientId: stu.id,
          type: 'EXTRA_CLASS',
          title: `${typeClean} class scheduled: ${subj.code} (${sec.displayName})`,
          message: `${subj.name} on ${date} (${startTime}–${endTime}) in ${roomClean} with ${conductingUser.name}${isSub ? ' (Substitute Faculty)' : ''}. Reason: ${reason.trim()}`,
          relatedRecordId: createdSession.id,
          targetNav: 'timetable',
          read: false,
          timestamp: now,
        }));

        if (conductingUser.id !== actor.id) {
          notifs.push({
            id: `notif-${Date.now()}-${conductingUser.id}`,
            recipientId: conductingUser.id,
            type: 'EXTRA_CLASS',
            title: `${isSub ? 'Substitute' : typeClean} session assigned: ${sec.displayName} — ${subj.code}`,
            message: `You are scheduled to conduct ${subj.name} for ${sec.displayName} on ${date} (${startTime}–${endTime}) in ${roomClean}.`,
            relatedRecordId: createdSession.id,
            targetNav: 'timetable',
            read: false,
            timestamp: now,
          });
        }
        await repo.createNotifications(notifs);
      } else {
        // Notify admins about pending faculty extra-class request
        const admins = allUsers.filter((u) => u.role === 'admin' && u.accountStatus === 'Active');
        await repo.createNotifications(
          admins.map((adm) => ({
            id: `notif-${Date.now()}-${adm.id}`,
            recipientId: adm.id,
            type: 'EXTRA_CLASS',
            title: `Extra class approval requested: ${sec.displayName} — ${subj.code}`,
            message: `${actor.name} requested a ${typeClean.toLowerCase()} class on ${date} (${startTime}–${endTime}) in ${roomClean}.`,
            relatedRecordId: createdSession.id,
            targetNav: 'admin-extra-classes',
            read: false,
            timestamp: now,
          }))
        );
      }

      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'CLASS_SESSION',
        attendanceRecordId: createdSession.id,
        sectionId: sec.id,
        sectionDisplayName: sec.displayName,
        subjectId: subj.id,
        subjectCode: subj.code,
        subjectName: subj.name,
        classId: createdSession.id,
        classDate: date,
        classPeriod: periodLabel,
        studentId: 'all',
        studentName: `${sec.displayName} Students`,
        studentIdentifier: sec.displayName,
        previousValue: originalSessionId ? `Original ${originalSessionId}` : 'Unscheduled',
        newValue: `${typeClean} (${approvalStatus}) · ${conductingUser.name}${isSub ? ' [Substitute]' : ''} · ${roomClean}`,
        previousVersion: 0,
        newVersion: 1,
        action: isApproved ? 'EXTRA_CLASS_SCHEDULED' : 'EXTRA_CLASS_REQUESTED',
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        reason: reason.trim(),
        evidenceReference: notes?.trim() || 'Academic Scheduling Console',
        timestamp: now,
      });

      res.status(201).json({ session: createdSession });
    }
  );

  // Manage existing ClassSession: Approve/Reject request, Cancel session, Move room, Reschedule, or Assign Substitute
  app.put(
    '/api/extra-classes/:id',
    requireAuth,
    requireRoles('admin', 'faculty'),
    async (req: AuthenticatedRequest, res: Response) => {
      const actor = req.user!;
      const policy = await repo.getPolicy();
      const existing = await repo.getClassById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Class session not found.' });
        return;
      }

      const {
        action,
        reason,
        date,
        period,
        startTime,
        endTime,
        classroom,
        actualFacultyId,
        topic,
      } = req.body as {
        action?: 'approve' | 'reject' | 'cancel' | 'update_schedule';
        reason?: string;
        date?: string;
        period?: string;
        startTime?: string;
        endTime?: string;
        classroom?: string;
        actualFacultyId?: string;
        topic?: string;
      };

      const now = new Date().toISOString();
      const allUsers = await repo.listAllUsers();
      const existingSessions = await repo.getAllSessions();
      const existingTimetable = await repo.getTimetable();

      if (action === 'approve' || action === 'reject') {
        if (actor.role !== 'admin') {
          res.status(403).json({ error: 'Only administrators may approve or reject extra class requests.' });
          return;
        }
        if (action === 'approve') {
          const facStored = await repo.findUserById(existing.facultyId);
          const conflicts = validateSessionConflicts({
            candidate: {
              id: existing.id,
              sectionId: existing.sectionId,
              date: existing.date,
              startTime: existing.startTime,
              endTime: existing.endTime,
              classroom: existing.classroom,
              actualFacultyId: existing.facultyId,
              originalSessionId: existing.originalSessionId,
            },
            existingSessions,
            existingTimetable,
            facultyUser: facStored ? repo.toPublicUser(facStored) : null,
            checkRooms: policy.enforceRoomConflictCheck,
          });
          if (conflicts.length > 0) {
            res.status(409).json({ error: conflicts[0].message, conflicts });
            return;
          }
        }

        const newApproval = action === 'approve' ? 'Approved' : 'Rejected';
        const newStatus: ClassSessionStatus =
          action === 'approve' ? 'Confirmed' : 'Cancelled';

        const updated = await repo.updateClassSession(existing.id, {
          approvalStatus: newApproval,
          status: newStatus,
          notes: reason?.trim()
            ? `${existing.notes ? existing.notes + ' | ' : ''}${reason.trim()}`
            : existing.notes,
          updatedBy: actor.id,
        });

        if (action === 'approve' && existing.originalSessionId) {
          await repo.updateClassSession(existing.originalSessionId, {
            status: 'Rescheduled',
            replacementSessionId: existing.id,
            rescheduleReason: existing.extraClassReason || reason?.trim() || 'Rescheduled',
            updatedBy: actor.id,
          });
        }

        if (action === 'approve') {
          const sectionStudents = allUsers.filter(
            (u) => u.role === 'student' && u.sectionId === existing.sectionId && u.accountStatus === 'Active'
          );
          await repo.createNotifications(
            sectionStudents.map((stu) => ({
              id: `notif-${Date.now()}-${stu.id}`,
              recipientId: stu.id,
              type: 'EXTRA_CLASS',
              title: `${existing.sessionType} class confirmed: ${existing.subjectCode} (${existing.sectionDisplayName})`,
              message: `${existing.subjectName || existing.topic} is confirmed for ${existing.date} (${existing.startTime}–${existing.endTime}) in ${existing.classroom} with ${existing.facultyName}.`,
              relatedRecordId: existing.id,
              targetNav: 'timetable',
              read: false,
              timestamp: now,
            }))
          );
        }

        await repo.appendAuditLog({
          id: `aud-${Date.now()}`,
          category: 'CLASS_SESSION',
          attendanceRecordId: existing.id,
          sectionId: existing.sectionId,
          sectionDisplayName: existing.sectionDisplayName,
          subjectId: existing.subjectId,
          subjectCode: existing.subjectCode || 'SUBJECT',
          subjectName: existing.subjectName || existing.topic,
          classId: existing.id,
          classDate: existing.date,
          classPeriod: existing.period,
          studentId: 'all',
          studentName: existing.sectionDisplayName,
          studentIdentifier: existing.sectionDisplayName,
          previousValue: existing.approvalStatus,
          newValue: newApproval,
          previousVersion: 1,
          newVersion: 2,
          action: action === 'approve' ? 'EXTRA_CLASS_APPROVED' : 'EXTRA_CLASS_REJECTED',
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: reason?.trim() || `Administrator ${newApproval.toLowerCase()} extra class request.`,
          evidenceReference: existing.id,
          timestamp: now,
        });

        res.json({ session: updated });
        return;
      }

      if (action === 'cancel') {
        const assignments = await repo.getFacultyAssignments();
        if (
          actor.role === 'faculty' &&
          !isFacultyAuthorizedForPair(
            actor.id,
            existing.sectionId,
            existing.subjectId,
            assignments,
            existing
          )
        ) {
          res.status(403).json({ error: 'Not authorized to cancel this class session.' });
          return;
        }
        if (existing.status === 'Conducted' || existing.attendanceSubmitted) {
          res.status(400).json({
            error: 'Cannot cancel a session after attendance has already been submitted.',
          });
          return;
        }

        const cancelReason = reason?.trim() || 'Cancelled by academic department.';
        const updated = await repo.updateClassSession(existing.id, {
          status: 'Cancelled',
          cancellationReason: cancelReason,
          updatedBy: actor.id,
        });

        if (existing.timetableEntryId) {
          const tt = existingTimetable.find((t) => t.id === existing.timetableEntryId);
          if (tt && tt.upcomingDate === existing.date) {
            await repo.updateTimetableEntry(tt.id, { upcomingStatus: 'Cancelled' });
          }
        }

        const sectionStudents = allUsers.filter(
          (u) => u.role === 'student' && u.sectionId === existing.sectionId && u.accountStatus === 'Active'
        );
        await repo.createNotifications(
          sectionStudents.map((stu) => ({
            id: `notif-${Date.now()}-${stu.id}`,
            recipientId: stu.id,
            type: 'TIMETABLE_CHANGE',
            title: `Class cancelled: ${existing.subjectCode} (${existing.sectionDisplayName})`,
            message: `${existing.subjectName || existing.topic} on ${existing.date} (${existing.period}) has been cancelled: ${cancelReason}`,
            relatedRecordId: existing.id,
            targetNav: 'timetable',
            read: false,
            timestamp: now,
          }))
        );

        await repo.appendAuditLog({
          id: `aud-${Date.now()}`,
          category: 'CLASS_SESSION',
          attendanceRecordId: existing.id,
          sectionId: existing.sectionId,
          sectionDisplayName: existing.sectionDisplayName,
          subjectId: existing.subjectId,
          subjectCode: existing.subjectCode || 'SUBJECT',
          subjectName: existing.subjectName || existing.topic,
          classId: existing.id,
          classDate: existing.date,
          classPeriod: existing.period,
          studentId: 'all',
          studentName: existing.sectionDisplayName,
          studentIdentifier: existing.sectionDisplayName,
          previousValue: existing.status,
          newValue: 'Cancelled',
          previousVersion: 1,
          newVersion: 2,
          action: 'SESSION_CANCELLED',
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: cancelReason,
          evidenceReference: existing.id,
          timestamp: now,
        });

        res.json({ session: updated });
        return;
      }

      // action === 'update_schedule' (Assign substitute faculty, move classroom, swap/reschedule slot)
      if (actor.role !== 'admin') {
        res.status(403).json({
          error: 'Only administrators may modify classroom assignments or assign substitute faculty.',
        });
        return;
      }
      if (existing.status === 'Conducted' || existing.attendanceSubmitted) {
        res.status(400).json({
          error: 'Cannot reschedule or reassign faculty for an already-conducted session.',
        });
        return;
      }

      const nextDate = date || existing.date;
      const nextStart = startTime || existing.startTime;
      const nextEnd = endTime || existing.endTime;
      const nextRoom = classroom?.trim() || existing.classroom;
      const nextFacId = actualFacultyId || existing.facultyId;

      const facStored = await repo.findUserById(nextFacId);
      if (!facStored || facStored.role !== 'faculty' || facStored.accountStatus !== 'Active') {
        res.status(400).json({ error: 'Selected faculty member must be an active faculty account.' });
        return;
      }
      const facUser = repo.toPublicUser(facStored);

      const conflicts = validateSessionConflicts({
        candidate: {
          id: existing.id,
          sectionId: existing.sectionId,
          date: nextDate,
          startTime: nextStart,
          endTime: nextEnd,
          classroom: nextRoom,
          actualFacultyId: facUser.id,
          originalSessionId: existing.originalSessionId,
        },
        existingSessions,
        existingTimetable,
        facultyUser: facUser,
        checkRooms: policy.enforceRoomConflictCheck,
      });

      if (conflicts.length > 0) {
        res.status(409).json({ error: conflicts[0].message, conflicts });
        return;
      }

      const isSub = facUser.id !== existing.scheduledFacultyId;
      const updated = await repo.updateClassSession(existing.id, {
        date: nextDate,
        period: period?.trim() || existing.period,
        startTime: nextStart,
        endTime: nextEnd,
        classroom: nextRoom,
        facultyId: facUser.id,
        facultyName: facUser.name,
        isSubstitute: isSub,
        ...(topic?.trim() ? { topic: topic.trim() } : {}),
        notes: reason?.trim()
          ? `${existing.notes ? existing.notes + ' | ' : ''}${reason.trim()}`
          : existing.notes,
        updatedBy: actor.id,
      });

      const sectionStudents = allUsers.filter(
        (u) => u.role === 'student' && u.sectionId === existing.sectionId && u.accountStatus === 'Active'
      );
      const notifs: AppNotification[] = sectionStudents.map((stu) => ({
        id: `notif-${Date.now()}-${stu.id}`,
        recipientId: stu.id,
        type: 'TIMETABLE_CHANGE',
        title: `Schedule update: ${existing.subjectCode} (${existing.sectionDisplayName})`,
        message: `${existing.subjectName || existing.topic} on ${nextDate} (${nextStart}–${nextEnd}) in ${nextRoom} will be conducted by ${facUser.name}${isSub ? ' (Substitute)' : ''}.`,
        relatedRecordId: existing.id,
        targetNav: 'timetable',
        read: false,
        timestamp: now,
      }));
      if (facUser.id !== existing.facultyId) {
        notifs.push({
          id: `notif-${Date.now()}-${facUser.id}`,
          recipientId: facUser.id,
          type: 'TIMETABLE_CHANGE',
          title: `Substitute class assigned: ${existing.sectionDisplayName} — ${existing.subjectCode}`,
          message: `You have been assigned to conduct ${existing.subjectCode} for ${existing.sectionDisplayName} on ${nextDate} (${nextStart}–${nextEnd}) in ${nextRoom}.`,
          relatedRecordId: existing.id,
          targetNav: 'timetable',
          read: false,
          timestamp: now,
        });
      }
      await repo.createNotifications(notifs);

      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'CLASS_SESSION',
        attendanceRecordId: existing.id,
        sectionId: existing.sectionId,
        sectionDisplayName: existing.sectionDisplayName,
        subjectId: existing.subjectId,
        subjectCode: existing.subjectCode || 'SUBJECT',
        subjectName: existing.subjectName || existing.topic,
        classId: existing.id,
        classDate: nextDate,
        classPeriod: period?.trim() || existing.period,
        studentId: 'all',
        studentName: existing.sectionDisplayName,
        studentIdentifier: existing.sectionDisplayName,
        previousValue: `${existing.date} ${existing.startTime} · ${existing.facultyName} · ${existing.classroom}`,
        newValue: `${nextDate} ${nextStart} · ${facUser.name}${isSub ? ' [Substitute]' : ''} · ${nextRoom}`,
        previousVersion: 1,
        newVersion: 2,
        action: isSub ? 'SUBSTITUTE_FACULTY_ASSIGNED' : 'SESSION_SCHEDULE_UPDATED',
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        reason: reason?.trim() || 'Updated class session schedule / substitute assignment.',
        evidenceReference: existing.id,
        timestamp: now,
      });

      res.json({ session: updated });
    }
  );

  // ============================================================================
  // ADMINISTRATOR ACADEMIC MANAGEMENT ENDPOINTS
  // ============================================================================

  // 1. Departments & Academic Sections
  app.post(
    '/api/admin/sections',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const { department, sectionName, semester, academicYear, programme, defaultClassroom } =
        req.body as {
          department?: string;
          sectionName?: string;
          semester?: number;
          academicYear?: string;
          programme?: string;
          defaultClassroom?: string;
        };

      if (!department?.trim() || !sectionName?.trim()) {
        res.status(400).json({ error: 'Department code and section identifier are required.' });
        return;
      }

      const deptClean = department.trim().toUpperCase();
      const secClean = sectionName.trim().toUpperCase();
      const displayName = `${deptClean} ${secClean}`;
      const newSec: AcademicSection = {
        id: `sec-${deptClean.toLowerCase()}-${secClean.toLowerCase()}-${Date.now().toString(36).slice(-4)}`,
        department: deptClean,
        sectionName: secClean,
        displayName,
        semester: Math.max(1, Math.min(8, Number(semester) || 5)),
        academicYear: academicYear?.trim() || '2026-27',
        programme: programme?.trim() || `B.E. ${deptClean}`,
        defaultClassroom: defaultClassroom?.trim() || 'LH-101',
        status: 'Active',
        isDemo: admin.isDemo,
      };

      try {
        const created = await repo.createSection(newSec);
        await repo.appendAuditLog({
          id: `aud-${Date.now()}`,
          category: 'ACCOUNT_ADMIN',
          attendanceRecordId: created.id,
          sectionId: created.id,
          sectionDisplayName: created.displayName,
          subjectId: 'admin',
          subjectCode: 'SECTION',
          subjectName: 'Academic Section Registry',
          classId: created.id,
          classDate: new Date().toISOString().slice(0, 10),
          classPeriod: 'Admin Action',
          studentId: 'all',
          studentName: created.displayName,
          studentIdentifier: created.displayName,
          previousValue: 'None',
          newValue: `${created.displayName} (Sem ${created.semester}, ${created.academicYear})`,
          previousVersion: 0,
          newVersion: 1,
          action: 'SECTION_CREATED',
          actorId: admin.id,
          actorName: admin.name,
          actorRole: admin.role,
          reason: `Created academic section ${created.displayName}.`,
          evidenceReference: 'Departments & Sections Console',
          timestamp: new Date().toISOString(),
        });
        res.status(201).json({ section: created });
      } catch (err) {
        res.status(409).json({
          error: err instanceof Error ? err.message : 'Unable to create academic section.',
        });
      }
    }
  );

  app.put(
    '/api/admin/sections/:id',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const existing = await repo.getSectionById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Academic section not found.' });
        return;
      }

      const { semester, academicYear, programme, defaultClassroom, status } = req.body as Partial<AcademicSection>;
      const updated = await repo.updateSection(existing.id, {
        ...(semester !== undefined ? { semester: Number(semester) } : {}),
        ...(academicYear ? { academicYear: academicYear.trim() } : {}),
        ...(programme ? { programme: programme.trim() } : {}),
        ...(defaultClassroom ? { defaultClassroom: defaultClassroom.trim() } : {}),
        ...(status ? { status } : {}),
      });

      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'ACCOUNT_ADMIN',
        attendanceRecordId: existing.id,
        sectionId: existing.id,
        sectionDisplayName: existing.displayName,
        subjectId: 'admin',
        subjectCode: 'SECTION',
        subjectName: 'Academic Section Registry',
        classId: existing.id,
        classDate: new Date().toISOString().slice(0, 10),
        classPeriod: 'Admin Action',
        studentId: 'all',
        studentName: existing.displayName,
        studentIdentifier: existing.displayName,
        previousValue: `${existing.status} · Room ${existing.defaultClassroom} · Sem ${existing.semester}`,
        newValue: `${updated?.status} · Room ${updated?.defaultClassroom} · Sem ${updated?.semester}`,
        previousVersion: 1,
        newVersion: 2,
        action: 'SECTION_UPDATED',
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        reason: `Updated section ${existing.displayName}.`,
        evidenceReference: 'Departments & Sections Console',
        timestamp: new Date().toISOString(),
      });

      res.json({ section: updated });
    }
  );

  // 2. Student Management (Add, Edit with Historical Section Preservation, Bulk CSV Preview & Import)
  app.post(
    '/api/admin/students',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const {
        name,
        identifier,
        email,
        sectionId,
        semester,
        academicYear,
        rollNumber,
        accountStatus,
        password,
      } = req.body as {
        name?: string;
        identifier?: string;
        email?: string;
        sectionId?: string;
        semester?: number;
        academicYear?: string;
        rollNumber?: string;
        accountStatus?: 'Active' | 'Inactive' | 'Suspended';
        password?: string;
      };

      if (!name?.trim() || !identifier?.trim() || !email?.trim() || !sectionId) {
        res.status(400).json({
          error: 'Full name, USN, email address, and assigned academic section are required.',
        });
        return;
      }

      if (!EMAIL_REGEX.test(email.trim())) {
        res.status(400).json({ error: 'Please provide a valid institutional email address.' });
        return;
      }

      const sec = await repo.getSectionById(sectionId);
      if (!sec) {
        res.status(404).json({ error: 'Assigned academic section was not found.' });
        return;
      }

      const dupId = await repo.findUserByLogin(identifier);
      const dupEmail = await repo.findUserByLogin(email);
      if (dupId || dupEmail) {
        res.status(409).json({
          error: 'A user with this USN or email address already exists.',
        });
        return;
      }

      const policy = await repo.getPolicy();
      const rawPassword = password?.trim() || 'Student@2026';
      const passwordHash = await bcrypt.hash(rawPassword, 10);

      const created = await repo.createUser({
        id: `stu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim(),
        identifier: identifier.trim().toUpperCase(),
        email: email.trim().toLowerCase(),
        passwordHash,
        role: 'student',
        college: policy.institutionName,
        department: sec.department,
        programme: sec.programme,
        semester: Number(semester) || sec.semester,
        section: sec.sectionName,
        sectionId: sec.id,
        sectionDisplayName: sec.displayName,
        academicYear: academicYear?.trim() || sec.academicYear,
        rollNumber: rollNumber?.trim() || '',
        accountStatus: accountStatus || 'Active',
        isDemo: admin.isDemo,
      });

      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'STUDENT_SECTION',
        attendanceRecordId: created.id,
        sectionId: sec.id,
        sectionDisplayName: sec.displayName,
        subjectId: 'admin',
        subjectCode: 'STUDENT',
        subjectName: 'Student Enrolment & Section Assignment',
        classId: sec.id,
        classDate: new Date().toISOString().slice(0, 10),
        classPeriod: 'Admin Action',
        studentId: created.id,
        studentName: created.name,
        studentIdentifier: created.identifier,
        previousValue: 'Unenrolled',
        newValue: `${sec.displayName} (Sem ${created.semester}, ${created.academicYear})`,
        previousVersion: 0,
        newVersion: 1,
        action: 'STUDENT_CREATED',
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        reason: `Enrolled student ${created.name} (${created.identifier}) into ${sec.displayName}.`,
        evidenceReference: 'Student Management Console',
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({ student: created });
    }
  );

  app.put(
    '/api/admin/students/:id',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const existing = await repo.findUserById(req.params.id);
      if (!existing || existing.role !== 'student') {
        res.status(404).json({ error: 'Student account not found.' });
        return;
      }

      const {
        name,
        email,
        sectionId,
        semester,
        academicYear,
        rollNumber,
        accountStatus,
        reason,
      } = req.body as {
        name?: string;
        email?: string;
        sectionId?: string;
        semester?: number;
        academicYear?: string;
        rollNumber?: string;
        accountStatus?: 'Active' | 'Inactive' | 'Suspended';
        reason?: string;
      };

      if (email && email.trim().toLowerCase() !== existing.email.toLowerCase()) {
        const dupEmail = await repo.findUserByLogin(email);
        if (dupEmail && dupEmail.id !== existing.id) {
          res.status(409).json({ error: 'Another user already uses that email address.' });
          return;
        }
      }

      const updates: Partial<StoredUser> = {};
      if (name?.trim()) updates.name = name.trim();
      if (email?.trim()) updates.email = email.trim().toLowerCase();
      if (semester !== undefined) updates.semester = Number(semester);
      if (academicYear?.trim()) updates.academicYear = academicYear.trim();
      if (rollNumber !== undefined) updates.rollNumber = rollNumber.trim();
      if (accountStatus) updates.accountStatus = accountStatus;

      let sectionChanged = false;
      let targetSec: AcademicSection | null = null;
      if (sectionId && sectionId !== existing.sectionId) {
        targetSec = await repo.getSectionById(sectionId);
        if (!targetSec) {
          res.status(404).json({ error: 'Target academic section not found.' });
          return;
        }
        sectionChanged = true;
        updates.sectionId = targetSec.id;
        updates.section = targetSec.sectionName;
        updates.sectionDisplayName = targetSec.displayName;
        updates.department = targetSec.department;
        updates.programme = targetSec.programme;
      }

      // IMPORTANT: Historical AttendanceRecord documents keep their original sectionId untouched!
      const updated = await repo.updateUser(existing.id, updates);

      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: sectionChanged ? 'STUDENT_SECTION' : 'ACCOUNT_ADMIN',
        attendanceRecordId: existing.id,
        sectionId: targetSec?.id || existing.sectionId,
        sectionDisplayName: targetSec?.displayName || existing.sectionDisplayName,
        subjectId: 'admin',
        subjectCode: 'STUDENT',
        subjectName: sectionChanged
          ? 'Student Section Transfer (Historical Attendance Preserved)'
          : 'Student Profile Update',
        classId: existing.id,
        classDate: new Date().toISOString().slice(0, 10),
        classPeriod: 'Admin Action',
        studentId: existing.id,
        studentName: updated?.name || existing.name,
        studentIdentifier: existing.identifier,
        previousValue: sectionChanged
          ? `${existing.sectionDisplayName || existing.section} (${existing.accountStatus})`
          : `${existing.accountStatus} · Sem ${existing.semester}`,
        newValue: sectionChanged
          ? `${targetSec!.displayName} (${updated?.accountStatus})`
          : `${updated?.accountStatus} · Sem ${updated?.semester}`,
        previousVersion: 1,
        newVersion: 2,
        action: sectionChanged ? 'STUDENT_SECTION_CHANGED' : 'STUDENT_UPDATED',
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        reason:
          reason?.trim() ||
          (sectionChanged
            ? `Transferred ${existing.identifier} from ${existing.sectionDisplayName} to ${targetSec!.displayName}. Historical attendance records remain attached to original sessions.`
            : `Updated student profile / status for ${existing.identifier}.`),
        evidenceReference: 'Student Management Console',
        timestamp: new Date().toISOString(),
      });

      res.json({ student: updated });
    }
  );

  app.post(
    '/api/admin/students/bulk-preview',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const { rows } = req.body as { rows?: BulkStudentCsvRowInput[] };
      if (!Array.isArray(rows)) {
        res.status(400).json({ error: 'Parsed CSV rows array is required.' });
        return;
      }
      const preview = await validateBulkStudentRows(rows);
      res.json(preview);
    }
  );

  app.post(
    '/api/admin/students/bulk-import',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const { rows } = req.body as { rows?: BulkStudentCsvRowInput[] };
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: 'CSV student rows are required for import.' });
        return;
      }

      const { validRows, duplicateRows, invalidRows } = await validateBulkStudentRows(rows);
      const policy = await repo.getPolicy();
      const defaultHash = await bcrypt.hash('Student@2026', 10);

      const toInsert: StoredUser[] = validRows.map((vr, idx) => ({
        id: `stu-csv-${Date.now()}-${idx}`,
        name: vr.name,
        identifier: vr.usn,
        email: vr.email,
        passwordHash: defaultHash,
        role: 'student',
        college: policy.institutionName,
        department: vr.department,
        programme: vr.programme,
        semester: vr.semester,
        section: vr.sectionName,
        sectionId: vr.sectionId,
        sectionDisplayName: vr.sectionDisplayName,
        academicYear: vr.academicYear,
        rollNumber: vr.rollNumber,
        accountStatus: vr.accountStatus,
        isDemo: admin.isDemo,
      }));

      const importedStudents = await repo.createManyUsers(toInsert);

      if (importedStudents.length > 0) {
        await repo.appendAuditLog({
          id: `aud-${Date.now()}`,
          category: 'STUDENT_SECTION',
          attendanceRecordId: `bulk-${Date.now()}`,
          subjectId: 'admin',
          subjectCode: 'BULK-CSV',
          subjectName: 'Bulk Student CSV Enrolment',
          classId: 'bulk-import',
          classDate: new Date().toISOString().slice(0, 10),
          classPeriod: 'Admin Action',
          studentId: 'all',
          studentName: `${importedStudents.length} Students Imported`,
          studentIdentifier: 'CSV-BATCH',
          previousValue: 'CSV Upload',
          newValue: `Imported ${importedStudents.length}; Skipped ${duplicateRows.length} duplicates; Rejected ${invalidRows.length} invalid`,
          previousVersion: 0,
          newVersion: 1,
          action: 'BULK_STUDENTS_IMPORTED',
          actorId: admin.id,
          actorName: admin.name,
          actorRole: admin.role,
          reason: `Bulk CSV import processed (${rows.length} total rows).`,
          evidenceReference: 'Student CSV Import Utility',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(201).json({
        importedCount: importedStudents.length,
        skippedDuplicatesCount: duplicateRows.length,
        invalidCount: invalidRows.length,
        importedStudents,
        duplicateRows,
        invalidRows,
      });
    }
  );

  // 3. Faculty Management (Add, Edit, Deactivate, Manage Availability Slots)
  app.post(
    '/api/admin/faculty',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const {
        name,
        identifier,
        email,
        department,
        designation,
        phone,
        accountStatus,
        password,
        unavailableSlots,
      } = req.body as {
        name?: string;
        identifier?: string;
        email?: string;
        department?: string;
        designation?: string;
        phone?: string;
        accountStatus?: 'Active' | 'Inactive' | 'Suspended';
        password?: string;
        unavailableSlots?: FacultyUnavailabilitySlot[];
      };

      if (!name?.trim() || !identifier?.trim() || !email?.trim() || !department?.trim()) {
        res.status(400).json({
          error: 'Full name, Faculty ID, official email, and department are required.',
        });
        return;
      }

      if (!EMAIL_REGEX.test(email.trim())) {
        res.status(400).json({ error: 'Please enter a valid official email address.' });
        return;
      }

      const dupId = await repo.findUserByLogin(identifier);
      const dupEmail = await repo.findUserByLogin(email);
      if (dupId || dupEmail) {
        res.status(409).json({
          error: 'A user with this Faculty ID or email address already exists.',
        });
        return;
      }

      const policy = await repo.getPolicy();
      const passwordHash = await bcrypt.hash(password?.trim() || 'Faculty@2026', 10);

      const created = await repo.createUser({
        id: `fac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim(),
        identifier: identifier.trim().toUpperCase(),
        email: email.trim().toLowerCase(),
        passwordHash,
        role: 'faculty',
        college: policy.institutionName,
        department: department.trim().toUpperCase(),
        programme: designation?.trim() || 'Assistant Professor',
        semester: policy.semester,
        section: 'All Assigned',
        designation: designation?.trim() || 'Assistant Professor',
        phone: phone?.trim() || '',
        unavailableSlots: Array.isArray(unavailableSlots) ? unavailableSlots : [],
        accountStatus: accountStatus || 'Active',
        isDemo: admin.isDemo,
      });

      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'ACCOUNT_ADMIN',
        attendanceRecordId: created.id,
        subjectId: 'admin',
        subjectCode: 'FACULTY',
        subjectName: 'Faculty Account Registry',
        classId: created.id,
        classDate: new Date().toISOString().slice(0, 10),
        classPeriod: 'Admin Action',
        studentId: created.id,
        studentName: created.name,
        studentIdentifier: created.identifier,
        previousValue: 'None',
        newValue: `${created.name} (${created.department} · ${created.designation})`,
        previousVersion: 0,
        newVersion: 1,
        action: 'FACULTY_CREATED',
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        reason: `Added faculty member ${created.name} (${created.identifier}).`,
        evidenceReference: 'Faculty Management Console',
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({ faculty: created });
    }
  );

  app.put(
    '/api/admin/faculty/:id',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const existing = await repo.findUserById(req.params.id);
      if (!existing || existing.role !== 'faculty') {
        res.status(404).json({ error: 'Faculty account not found.' });
        return;
      }

      const {
        name,
        email,
        department,
        designation,
        phone,
        accountStatus,
        unavailableSlots,
      } = req.body as {
        name?: string;
        email?: string;
        department?: string;
        designation?: string;
        phone?: string;
        accountStatus?: 'Active' | 'Inactive' | 'Suspended';
        unavailableSlots?: FacultyUnavailabilitySlot[];
      };

      const updates: Partial<StoredUser> = {};
      if (name?.trim()) updates.name = name.trim();
      if (email?.trim()) updates.email = email.trim().toLowerCase();
      if (department?.trim()) updates.department = department.trim().toUpperCase();
      if (designation !== undefined) {
        updates.designation = designation.trim();
        updates.programme = designation.trim() || existing.programme;
      }
      if (phone !== undefined) updates.phone = phone.trim();
      if (accountStatus) updates.accountStatus = accountStatus;
      if (Array.isArray(unavailableSlots)) updates.unavailableSlots = unavailableSlots;

      const updated = await repo.updateUser(existing.id, updates);

      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'ACCOUNT_ADMIN',
        attendanceRecordId: existing.id,
        subjectId: 'admin',
        subjectCode: 'FACULTY',
        subjectName: 'Faculty Account & Availability Update',
        classId: existing.id,
        classDate: new Date().toISOString().slice(0, 10),
        classPeriod: 'Admin Action',
        studentId: existing.id,
        studentName: updated?.name || existing.name,
        studentIdentifier: existing.identifier,
        previousValue: `${existing.accountStatus} · ${existing.unavailableSlots?.length || 0} unavailability slots`,
        newValue: `${updated?.accountStatus} · ${updated?.unavailableSlots?.length || 0} unavailability slots`,
        previousVersion: 1,
        newVersion: 2,
        action: 'FACULTY_UPDATED',
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        reason: `Updated faculty profile / availability for ${existing.identifier}.`,
        evidenceReference: 'Faculty Management Console',
        timestamp: new Date().toISOString(),
      });

      res.json({ faculty: updated });
    }
  );

  // 4. Subject Management (Add & Edit)
  app.post(
    '/api/admin/subjects',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const {
        code,
        name,
        department,
        semester,
        programme,
        credits,
        attendanceRequirement,
        assignedFacultyId,
        academicYear,
        estimatedRemainingClasses,
      } = req.body as Partial<SubjectItem>;

      if (!code?.trim() || !name?.trim()) {
        res.status(400).json({ error: 'Subject code and subject title are required.' });
        return;
      }

      const codeUpper = code.trim().toUpperCase();
      const allSubjects = await repo.getSubjects();
      if (allSubjects.some((s) => s.code.toUpperCase() === codeUpper)) {
        res.status(409).json({ error: `Subject code ${codeUpper} already exists.` });
        return;
      }

      const fac = assignedFacultyId ? await repo.findUserById(assignedFacultyId) : null;
      const policy = await repo.getPolicy();

      const newSubj: SubjectItem = {
        id: `subj-${codeUpper.toLowerCase()}-${Date.now().toString(36).slice(-4)}`,
        code: codeUpper,
        name: name.trim(),
        department: department?.trim().toUpperCase() || 'CSE',
        semester: Number(semester) || policy.semester,
        programme: programme?.trim() || policy.programme,
        credits: Math.max(0, Number(credits) ?? 3),
        attendanceRequirement: Math.max(
          50,
          Math.min(100, Number(attendanceRequirement) || policy.defaultMinimumPercentage)
        ),
        assignedFacultyId: fac?.id || 'fac-001',
        assignedFacultyName: fac?.name || 'Department Coordinator',
        academicYear: academicYear?.trim() || policy.academicYear,
        estimatedRemainingClasses: Math.max(0, Number(estimatedRemainingClasses) || 24),
        status: 'Active',
        isDemo: admin.isDemo,
      };

      const created = await repo.createSubject(newSubj);
      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'ACCOUNT_ADMIN',
        attendanceRecordId: created.id,
        subjectId: created.id,
        subjectCode: created.code,
        subjectName: created.name,
        classId: created.id,
        classDate: new Date().toISOString().slice(0, 10),
        classPeriod: 'Admin Action',
        studentId: 'all',
        studentName: created.department,
        studentIdentifier: created.code,
        previousValue: 'None',
        newValue: `${created.code} — ${created.name} (Min ${created.attendanceRequirement}%)`,
        previousVersion: 0,
        newVersion: 1,
        action: 'SUBJECT_CREATED',
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        reason: `Added curriculum subject ${created.code}.`,
        evidenceReference: 'Subject Management Console',
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({ subject: created });
    }
  );

  app.put(
    '/api/admin/subjects/:id',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const {
        name,
        department,
        semester,
        credits,
        attendanceRequirement,
        assignedFacultyId,
        estimatedRemainingClasses,
        status,
      } = req.body as Partial<SubjectItem>;

      const updates: Partial<SubjectItem> = {};
      if (name?.trim()) updates.name = name.trim();
      if (department?.trim()) updates.department = department.trim().toUpperCase();
      if (semester !== undefined) updates.semester = Number(semester);
      if (credits !== undefined) updates.credits = Math.max(0, Number(credits));
      if (status) updates.status = status;

      if (attendanceRequirement !== undefined) {
        const reqNum = Number(attendanceRequirement);
        if (Number.isNaN(reqNum) || reqNum < 50 || reqNum > 100) {
          res.status(400).json({ error: 'Subject requirement must be between 50% and 100%.' });
          return;
        }
        updates.attendanceRequirement = reqNum;
      }
      if (estimatedRemainingClasses !== undefined) {
        updates.estimatedRemainingClasses = Math.max(0, Number(estimatedRemainingClasses) || 0);
      }
      if (assignedFacultyId) {
        const fac = await repo.findUserById(assignedFacultyId);
        if (fac && fac.role === 'faculty') {
          updates.assignedFacultyId = fac.id;
          updates.assignedFacultyName = fac.name;
        }
      }

      const updated = await repo.updateSubject(req.params.id, updates);
      if (!updated) {
        res.status(404).json({ error: 'Subject not found.' });
        return;
      }

      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'ACCOUNT_ADMIN',
        attendanceRecordId: updated.id,
        subjectId: updated.id,
        subjectCode: updated.code,
        subjectName: updated.name,
        classId: updated.id,
        classDate: new Date().toISOString().slice(0, 10),
        classPeriod: 'Admin Action',
        studentId: 'all',
        studentName: updated.department,
        studentIdentifier: updated.code,
        previousValue: 'Subject Configuration',
        newValue: `${updated.status} · Min ${updated.attendanceRequirement}% · Coord: ${updated.assignedFacultyName}`,
        previousVersion: 1,
        newVersion: 2,
        action: 'SUBJECT_UPDATED',
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        reason: `Updated subject configuration for ${updated.code}.`,
        evidenceReference: 'Subject Management Console',
        timestamp: new Date().toISOString(),
      });

      res.json({ subject: updated });
    }
  );

  // 5. Faculty Assignments (Faculty -> Subject -> Section -> Semester)
  app.post(
    '/api/admin/faculty-assignments',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const { facultyId, subjectId, sectionId, startDate, endDate } = req.body as {
        facultyId?: string;
        subjectId?: string;
        sectionId?: string;
        startDate?: string;
        endDate?: string;
      };

      if (!facultyId || !subjectId || !sectionId) {
        res.status(400).json({
          error: 'Faculty member, subject, and academic section are all required.',
        });
        return;
      }

      const fac = await repo.findUserById(facultyId);
      const sec = await repo.getSectionById(sectionId);
      const subjects = await repo.getSubjects();
      const subj = subjects.find((s) => s.id === subjectId);

      if (!fac || fac.role !== 'faculty' || fac.accountStatus !== 'Active') {
        res.status(400).json({ error: 'Selected faculty member must be an active faculty account.' });
        return;
      }
      if (!sec || !subj) {
        res.status(404).json({ error: 'Selected section or subject was not found.' });
        return;
      }

      const fa: FacultyAssignment = {
        id: `fa-${sec.id}-${subj.id}-${Date.now().toString(36).slice(-4)}`,
        facultyId: fac.id,
        facultyName: fac.name,
        subjectId: subj.id,
        subjectCode: subj.code,
        subjectName: subj.name,
        sectionId: sec.id,
        sectionDisplayName: sec.displayName,
        department: sec.department,
        semester: sec.semester,
        academicYear: sec.academicYear,
        startDate: startDate || '2026-08-01',
        endDate: endDate || '2026-12-20',
        status: 'Active',
        isDemo: admin.isDemo,
      };

      try {
        const created = await repo.createFacultyAssignment(fa);
        await repo.createNotifications([
          {
            id: `notif-${Date.now()}-${fac.id}`,
            recipientId: fac.id,
            type: 'POLICY_NOTICE',
            title: `New teaching assignment: ${sec.displayName} — ${subj.code}`,
            message: `You have been assigned to teach ${subj.name} (${subj.code}) for ${sec.displayName} (Semester ${sec.semester}).`,
            targetNav: 'my-attendance',
            read: false,
            timestamp: new Date().toISOString(),
          },
        ]);

        await repo.appendAuditLog({
          id: `aud-${Date.now()}`,
          category: 'FACULTY_ASSIGNMENT',
          attendanceRecordId: created.id,
          sectionId: sec.id,
          sectionDisplayName: sec.displayName,
          subjectId: subj.id,
          subjectCode: subj.code,
          subjectName: subj.name,
          classId: created.id,
          classDate: new Date().toISOString().slice(0, 10),
          classPeriod: 'Admin Action',
          studentId: fac.id,
          studentName: fac.name,
          studentIdentifier: fac.identifier,
          previousValue: 'Unassigned',
          newValue: `${fac.name} → ${subj.code} → ${sec.displayName}`,
          previousVersion: 0,
          newVersion: 1,
          action: 'FACULTY_ASSIGNED',
          actorId: admin.id,
          actorName: admin.name,
          actorRole: admin.role,
          reason: `Assigned ${fac.name} to ${subj.code} for section ${sec.displayName}.`,
          evidenceReference: 'Faculty Assignments Console',
          timestamp: new Date().toISOString(),
        });

        res.status(201).json({ assignment: created });
      } catch (err) {
        res.status(409).json({
          error: err instanceof Error ? err.message : 'Unable to save faculty assignment.',
        });
      }
    }
  );

  app.put(
    '/api/admin/faculty-assignments/:id',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const all = await repo.getFacultyAssignments();
      const existing = all.find((x) => x.id === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Faculty assignment not found.' });
        return;
      }

      const { status, facultyId } = req.body as {
        status?: 'Active' | 'Inactive';
        facultyId?: string;
      };

      const updates: Partial<FacultyAssignment> = {};
      if (status) updates.status = status;
      if (facultyId && facultyId !== existing.facultyId) {
        const fac = await repo.findUserById(facultyId);
        if (!fac || fac.role !== 'faculty' || fac.accountStatus !== 'Active') {
          res.status(400).json({ error: 'Replacement faculty must be an active faculty account.' });
          return;
        }
        updates.facultyId = fac.id;
        updates.facultyName = fac.name;
      }

      const updated = await repo.updateFacultyAssignment(existing.id, updates);

      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'FACULTY_ASSIGNMENT',
        attendanceRecordId: existing.id,
        sectionId: existing.sectionId,
        sectionDisplayName: existing.sectionDisplayName,
        subjectId: existing.subjectId,
        subjectCode: existing.subjectCode,
        subjectName: existing.subjectName,
        classId: existing.id,
        classDate: new Date().toISOString().slice(0, 10),
        classPeriod: 'Admin Action',
        studentId: updated?.facultyId || existing.facultyId,
        studentName: updated?.facultyName || existing.facultyName,
        studentIdentifier: existing.sectionDisplayName,
        previousValue: `${existing.facultyName} (${existing.status})`,
        newValue: `${updated?.facultyName} (${updated?.status})`,
        previousVersion: 1,
        newVersion: 2,
        action: 'FACULTY_ASSIGNMENT_UPDATED',
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        reason: `Updated faculty assignment for ${existing.sectionDisplayName} — ${existing.subjectCode}.`,
        evidenceReference: 'Faculty Assignments Console',
        timestamp: new Date().toISOString(),
      });

      res.json({ assignment: updated });
    }
  );

  // 6. Timetable Management (Conflict-checked Create, Update, Delete + Upcoming Scheduled Session Sync)
  app.post(
    '/api/admin/timetable',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const policy = await repo.getPolicy();
      const {
        facultyAssignmentId,
        dayOfWeek,
        period,
        startTime,
        endTime,
        classroom,
        batch,
        upcomingDate,
      } = req.body as {
        facultyAssignmentId?: string;
        dayOfWeek?: TimetableEntry['dayOfWeek'];
        period?: string;
        startTime?: string;
        endTime?: string;
        classroom?: string;
        batch?: 'B1' | 'B2' | 'All';
        upcomingDate?: string;
      };

      if (!facultyAssignmentId || !dayOfWeek || !startTime || !endTime) {
        res.status(400).json({
          error: 'Faculty assignment, day of week, start time, and end time are required.',
        });
        return;
      }

      const assignments = await repo.getFacultyAssignments();
      const fa = assignments.find((x) => x.id === facultyAssignmentId && x.status === 'Active');
      if (!fa) {
        res.status(404).json({ error: 'Selected active faculty assignment was not found.' });
        return;
      }

      const sec = await repo.getSectionById(fa.sectionId);
      const facStored = await repo.findUserById(fa.facultyId);
      const roomClean = classroom?.trim() || sec?.defaultClassroom || 'LH-301';

      const existingTimetable = await repo.getTimetable();
      const conflicts = validateTimetableEntryConflicts({
        candidate: {
          sectionId: fa.sectionId,
          facultyId: fa.facultyId,
          dayOfWeek,
          startTime,
          endTime,
          classroom: roomClean,
          batch: batch || 'All',
        },
        existingTimetable,
        facultyUser: facStored ? repo.toPublicUser(facStored) : null,
        checkRooms: policy.enforceRoomConflictCheck,
      });

      if (conflicts.length > 0) {
        res.status(409).json({
          error: conflicts[0].message,
          conflicts,
        });
        return;
      }

      const nextDate = upcomingDate || '2026-10-26';
      const entryId = `tt-${fa.sectionId}-${Date.now().toString(36).slice(-5)}`;
      const periodClean = period?.trim() || `Slot (${startTime} - ${endTime})`;

      const entry: TimetableEntry = {
        id: entryId,
        sectionId: fa.sectionId,
        sectionDisplayName: fa.sectionDisplayName,
        subjectId: fa.subjectId,
        subjectCode: fa.subjectCode,
        subjectName: fa.subjectName,
        facultyAssignmentId: fa.id,
        facultyId: fa.facultyId,
        facultyName: fa.facultyName,
        dayOfWeek,
        period: periodClean,
        startTime,
        endTime,
        classroom: roomClean,
        batch: batch || 'All',
        validityPeriod: `${fa.startDate} to ${fa.endDate}`,
        upcomingDate: nextDate,
        upcomingStatus: 'Scheduled',
        status: 'Active',
      };

      const created = await repo.createTimetableEntry(entry);

      // Instantiate an upcoming Scheduled ClassSession so the teacher can immediately mark roll for it
      const scheduledSession: ClassSession = {
        id: `cls-sched-${entryId}`,
        sectionId: fa.sectionId,
        sectionDisplayName: fa.sectionDisplayName,
        subjectId: fa.subjectId,
        subjectCode: fa.subjectCode,
        subjectName: fa.subjectName,
        timetableEntryId: entryId,
        date: nextDate,
        period: `${periodClean} (${startTime} - ${endTime})`,
        startTime,
        endTime,
        durationHours: 1,
        topic: `Scheduled Lecture — ${fa.subjectName}`,
        sessionType: 'Regular',
        status: 'Scheduled',
        scheduledFacultyId: fa.facultyId,
        scheduledFacultyName: fa.facultyName,
        facultyId: fa.facultyId,
        facultyName: fa.facultyName,
        isSubstitute: false,
        classroom: roomClean,
        batch: entry.batch,
        attendanceSubmitted: false,
        approvalStatus: 'Approved',
        createdBy: admin.id,
        isDemo: admin.isDemo,
      };
      await repo.createClassSession(scheduledSession);

      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'TIMETABLE',
        attendanceRecordId: created.id,
        sectionId: fa.sectionId,
        sectionDisplayName: fa.sectionDisplayName,
        subjectId: fa.subjectId,
        subjectCode: fa.subjectCode,
        subjectName: fa.subjectName,
        classId: created.id,
        classDate: nextDate,
        classPeriod: periodClean,
        studentId: 'all',
        studentName: fa.sectionDisplayName,
        studentIdentifier: fa.sectionDisplayName,
        previousValue: 'Unscheduled',
        newValue: `${dayOfWeek} ${startTime}–${endTime} · ${fa.facultyName} · ${roomClean}`,
        previousVersion: 0,
        newVersion: 1,
        action: 'TIMETABLE_SLOT_CREATED',
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        reason: `Added timetable slot for ${fa.sectionDisplayName} — ${fa.subjectCode}.`,
        evidenceReference: 'Timetable Management Console',
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({ entry: created, scheduledSession });
    }
  );

  app.put(
    '/api/admin/timetable/:id',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const policy = await repo.getPolicy();
      const existingTimetable = await repo.getTimetable();
      const current = existingTimetable.find((t) => t.id === req.params.id);
      if (!current) {
        res.status(404).json({ error: 'Timetable entry not found.' });
        return;
      }

      const { dayOfWeek, period, startTime, endTime, classroom, upcomingDate, status } =
        req.body as Partial<TimetableEntry>;

      const nextDay = dayOfWeek || current.dayOfWeek;
      const nextStart = startTime || current.startTime;
      const nextEnd = endTime || current.endTime;
      const nextRoom = classroom?.trim() || current.classroom;
      const nextStatus = status || current.status;

      if (nextStatus === 'Active') {
        const facStored = await repo.findUserById(current.facultyId);
        const conflicts = validateTimetableEntryConflicts({
          candidate: {
            id: current.id,
            sectionId: current.sectionId,
            facultyId: current.facultyId,
            dayOfWeek: nextDay,
            startTime: nextStart,
            endTime: nextEnd,
            classroom: nextRoom,
          },
          existingTimetable,
          facultyUser: facStored ? repo.toPublicUser(facStored) : null,
          checkRooms: policy.enforceRoomConflictCheck,
        });

        if (conflicts.length > 0) {
          res.status(409).json({ error: conflicts[0].message, conflicts });
          return;
        }
      }

      const updated = await repo.updateTimetableEntry(current.id, {
        dayOfWeek: nextDay,
        period: period?.trim() || current.period,
        startTime: nextStart,
        endTime: nextEnd,
        classroom: nextRoom,
        upcomingDate: upcomingDate || current.upcomingDate,
        status: nextStatus,
      });

      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'TIMETABLE',
        attendanceRecordId: current.id,
        sectionId: current.sectionId,
        sectionDisplayName: current.sectionDisplayName,
        subjectId: current.subjectId,
        subjectCode: current.subjectCode,
        subjectName: current.subjectName,
        classId: current.id,
        classDate: upcomingDate || current.upcomingDate,
        classPeriod: period?.trim() || current.period,
        studentId: 'all',
        studentName: current.sectionDisplayName,
        studentIdentifier: current.sectionDisplayName,
        previousValue: `${current.dayOfWeek} ${current.startTime}–${current.endTime} (${current.classroom})`,
        newValue: `${nextDay} ${nextStart}–${nextEnd} (${nextRoom}) [${nextStatus}]`,
        previousVersion: 1,
        newVersion: 2,
        action: 'TIMETABLE_SLOT_UPDATED',
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        reason: `Updated timetable slot for ${current.sectionDisplayName} — ${current.subjectCode}.`,
        evidenceReference: 'Timetable Management Console',
        timestamp: new Date().toISOString(),
      });

      res.json({ entry: updated });
    }
  );

  app.delete(
    '/api/admin/timetable/:id',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const existingTimetable = await repo.getTimetable();
      const current = existingTimetable.find((t) => t.id === req.params.id);
      if (!current) {
        res.status(404).json({ error: 'Timetable entry not found.' });
        return;
      }

      await repo.deleteTimetableEntry(current.id);
      await repo.appendAuditLog({
        id: `aud-${Date.now()}`,
        category: 'TIMETABLE',
        attendanceRecordId: current.id,
        sectionId: current.sectionId,
        sectionDisplayName: current.sectionDisplayName,
        subjectId: current.subjectId,
        subjectCode: current.subjectCode,
        subjectName: current.subjectName,
        classId: current.id,
        classDate: current.upcomingDate,
        classPeriod: current.period,
        studentId: 'all',
        studentName: current.sectionDisplayName,
        studentIdentifier: current.sectionDisplayName,
        previousValue: `${current.dayOfWeek} ${current.startTime}–${current.endTime}`,
        newValue: 'Removed',
        previousVersion: 1,
        newVersion: 2,
        action: 'TIMETABLE_SLOT_REMOVED',
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        reason: `Removed timetable slot for ${current.sectionDisplayName} — ${current.subjectCode}.`,
        evidenceReference: 'Timetable Management Console',
        timestamp: new Date().toISOString(),
      });

      res.json({ ok: true });
    }
  );

  // 7. Institutional Policy Configuration
  app.put(
    '/api/admin/policy',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const admin = req.user!;
      const body = req.body || {};
      const minPct = Number(body.defaultMinimumPercentage);
      if (Number.isNaN(minPct) || minPct < 50 || minPct > 100) {
        res.status(400).json({
          error: 'Default minimum attendance percentage must be between 50% and 100%.',
        });
        return;
      }

      const updated = await repo.updatePolicy(
        {
          institutionName: body.institutionName,
          academicYear: body.academicYear,
          semester: Number(body.semester) || 5,
          defaultMinimumPercentage: minPct,
          warningBufferPercentage: Math.max(
            1,
            Math.min(15, Number(body.warningBufferPercentage) || 4)
          ),
          calculationMethod: body.calculationMethod,
          cancelledClassPolicy: body.cancelledClassPolicy,
          excusedAbsencePolicy: body.excusedAbsencePolicy,
          approvalPermissions: Array.isArray(body.approvalPermissions)
            ? body.approvalPermissions
            : ['faculty', 'admin'],
          evidenceRequiredForSubmission: Boolean(body.evidenceRequiredForSubmission),
          allowAppeals: Boolean(body.allowAppeals),
          ...(body.allowFacultyExtraClassRequests !== undefined
            ? { allowFacultyExtraClassRequests: Boolean(body.allowFacultyExtraClassRequests) }
            : {}),
          ...(body.enforceRoomConflictCheck !== undefined
            ? { enforceRoomConflictCheck: Boolean(body.enforceRoomConflictCheck) }
            : {}),
          policyLastVerifiedNote: body.policyLastVerifiedNote,
        },
        admin
      );
      res.json({ policy: updated });
    }
  );

  // ============================================================================
  // EVIDENCE-BASED ATTENDANCE CORRECTION WORKFLOW & PRIVATE FILE STREAMING
  // ============================================================================

  app.post(
    '/api/corrections',
    requireAuth,
    requireRoles('student'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      upload.array('evidence', 3)(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message || 'Evidence upload validation failed.' });
          return;
        }
        next();
      });
    },
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const policy = await repo.getPolicy();
      const {
        attendanceRecordId,
        requestedStatus,
        reason,
        supportingNotes,
        documentCategory,
        saveAsDraft,
      } = req.body as {
        attendanceRecordId?: string;
        requestedStatus?: 'Present' | 'Excused';
        reason?: string;
        supportingNotes?: string;
        documentCategory?: string;
        saveAsDraft?: string;
      };

      const isDraft = saveAsDraft === 'true';

      if (!attendanceRecordId) {
        res.status(400).json({
          error: 'Please select an absent class record.',
        });
        return;
      }

      const record = await repo.getRecordById(attendanceRecordId);
      if (!record || record.studentId !== user.id) {
        res.status(403).json({
          error: 'You can only submit evidence for your own attendance record.',
        });
        return;
      }

      if (record.status === 'Present') {
        res.status(400).json({ error: 'This class is already recorded as Present.' });
        return;
      }

      if (record.pendingRequestId) {
        res.status(409).json({
          error: 'An evidence submission is already under review for this class session.',
        });
        return;
      }

      const uploadedFiles = (req.files as Express.Multer.File[]) || [];
      if (!isDraft && uploadedFiles.length === 0) {
        res.status(400).json({
          error: 'Supporting evidence file (PDF, JPG, or PNG) is required.',
        });
        return;
      }

      const cls = await repo.getClassById(record.classId);
      const subjects = await repo.getSubjects();
      const subj = subjects.find((s) => s.id === record.subjectId);
      if (!cls || !subj) {
        res.status(404).json({ error: 'Associated subject or class session could not be found.' });
        return;
      }

      const sec = await repo.getSectionById(record.sectionId || cls.sectionId);
      const assignments = await repo.getFacultyAssignments();
      const assignedForSection = assignments.find(
        (a) =>
          a.status === 'Active' &&
          a.sectionId === (record.sectionId || cls.sectionId) &&
          a.subjectId === subj.id
      );
      const notifyFacultyId =
        assignedForSection?.facultyId || cls.facultyId || subj.assignedFacultyId;

      const now = new Date().toISOString();
      const evidenceFiles: EvidenceFileMeta[] = uploadedFiles.map((f, idx) => ({
        id: `ev-${Date.now()}-${idx}`,
        originalName: f.originalname,
        storedName: f.filename,
        mimeType: f.mimetype,
        sizeBytes: f.size,
        documentCategory: documentCategory?.trim() || 'Supporting Document',
        uploadedAt: now,
      }));

      const refNum = `VTU-CORR-2026-${String(Math.floor(1000 + Math.random() * 8999))}`;
      const status: CorrectionWorkflowStatus = isDraft ? 'Draft' : 'Submitted';

      const resolvedDocType = documentCategory?.trim() || reason?.trim() || 'Official Supporting Document';

      const newReq: AttendanceCorrectionRequest = {
        id: `corr-${Date.now()}`,
        referenceNumber: refNum,
        studentId: user.id,
        studentName: user.name,
        studentIdentifier: user.identifier,
        sectionId: record.sectionId || cls.sectionId,
        sectionDisplayName: sec?.displayName || cls.sectionDisplayName || user.sectionDisplayName || 'Section',
        attendanceRecordId: record.id,
        subjectId: subj.id,
        subjectCode: subj.code,
        subjectName: subj.name,
        classId: cls.id,
        classDate: cls.date,
        classPeriod: cls.period,
        classTopic: cls.topic,
        originalStatus: record.status,
        requestedStatus: requestedStatus === 'Excused' ? 'Excused' : 'Present',
        reason: resolvedDocType,
        supportingNotes: supportingNotes?.trim() || '',
        evidenceFiles,
        evidenceAccessLogs: [],
        workflowStatus: status,
        appealCount: 0,
        timeline: [
          {
            status,
            actorName: user.name,
            actorRole: 'student',
            note: `Uploaded ${resolvedDocType}`,
            timestamp: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      const saved = await repo.saveNewCorrectionRequest(newReq, notifyFacultyId);
      res.status(201).json({ request: saved });
    }
  );

  app.post(
    '/api/corrections/:id/resubmit',
    requireAuth,
    requireRoles('student'),
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      upload.array('evidence', 3)(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message || 'Evidence upload validation failed.' });
          return;
        }
        next();
      });
    },
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const policy = await repo.getPolicy();
      const existing = await repo.getCorrectionById(req.params.id);
      if (!existing || existing.studentId !== user.id) {
        res.status(404).json({ error: 'Correction request not found.' });
        return;
      }

      const allowedStates: CorrectionWorkflowStatus[] = [
        'Draft',
        'Additional Evidence Requested',
        'Rejected',
      ];
      if (!allowedStates.includes(existing.workflowStatus)) {
        res.status(400).json({
          error: `Requests in "${existing.workflowStatus}" status cannot be resubmitted.`,
        });
        return;
      }

      if (existing.workflowStatus === 'Rejected' && !policy.allowAppeals) {
        res.status(403).json({
          error: 'Appeals on rejected correction requests are currently disabled by institutional policy.',
        });
        return;
      }

      const { note, documentCategory } = req.body as {
        note?: string;
        documentCategory?: string;
      };
      const uploadedFiles = (req.files as Express.Multer.File[]) || [];
      if (uploadedFiles.length === 0) {
        res.status(400).json({
          error: 'Please upload a supporting evidence file (PDF, JPG, or PNG) to resubmit.',
        });
        return;
      }
      const now = new Date().toISOString();

      const addedEvidence: EvidenceFileMeta[] = uploadedFiles.map((f, idx) => ({
        id: `ev-${Date.now()}-${idx}`,
        originalName: f.originalname,
        storedName: f.filename,
        mimeType: f.mimetype,
        sizeBytes: f.size,
        documentCategory: documentCategory?.trim() || 'Supplemental Evidence',
        uploadedAt: now,
      }));

      const wasRejected = existing.workflowStatus === 'Rejected';
      const assignments = await repo.getFacultyAssignments();
      const assignedFa = assignments.find(
        (a) =>
          a.status === 'Active' &&
          a.sectionId === existing.sectionId &&
          a.subjectId === existing.subjectId
      );
      const subjects = await repo.getSubjects();
      const subj = subjects.find((s) => s.id === existing.subjectId);
      const targetFacId = assignedFa?.facultyId || subj?.assignedFacultyId;

      const updated: AttendanceCorrectionRequest = {
        ...existing,
        workflowStatus: 'Submitted',
        appealCount: wasRejected ? existing.appealCount + 1 : existing.appealCount,
        supportingNotes: note?.trim()
          ? `${existing.supportingNotes ? existing.supportingNotes + ' | ' : ''}${note.trim()}`
          : existing.supportingNotes,
        evidenceFiles: [...existing.evidenceFiles, ...addedEvidence],
        timeline: [
          ...existing.timeline,
          {
            status: 'Submitted',
            actorName: user.name,
            actorRole: 'student',
            note: wasRejected
              ? `Submitted appeal with clarification${addedEvidence.length ? ' and supplemental documentation' : ''}.`
              : note?.trim() || 'Provided supplemental evidence and resubmitted for review.',
            timestamp: now,
          },
        ],
        updatedAt: now,
      };

      const record = await repo.getRecordById(existing.attendanceRecordId);
      const updatedRecord = record ? { ...record, pendingRequestId: updated.id } : undefined;

      await repo.updateCorrectionRequest(updated, {
        updatedAttendanceRecord: updatedRecord,
        notification: targetFacId
          ? {
              id: `notif-${Date.now()}`,
              recipientId: targetFacId,
              type: 'CORRECTION_SUBMITTED',
              title: `Updated request ${updated.referenceNumber} (${updated.sectionDisplayName})`,
              message: `${user.name} submitted updated documentation for ${updated.subjectCode} (${updated.classDate}).`,
              relatedRecordId: updated.id,
              targetNav: 'corrections',
              read: false,
              timestamp: now,
            }
          : undefined,
      });

      res.json({ request: updated });
    }
  );

  app.post(
    '/api/corrections/:id/withdraw',
    requireAuth,
    requireRoles('student'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const existing = await repo.getCorrectionById(req.params.id);
      if (!existing || existing.studentId !== user.id) {
        res.status(404).json({ error: 'Correction request not found.' });
        return;
      }
      if (existing.workflowStatus === 'Approved' || existing.workflowStatus === 'Withdrawn') {
        res.status(400).json({
          error: `Cannot withdraw a request that is already ${existing.workflowStatus}.`,
        });
        return;
      }

      const now = new Date().toISOString();
      const updated: AttendanceCorrectionRequest = {
        ...existing,
        workflowStatus: 'Withdrawn',
        timeline: [
          ...existing.timeline,
          {
            status: 'Withdrawn',
            actorName: user.name,
            actorRole: 'student',
            note: 'Withdrawn by student. Original attendance record remains unchanged.',
            timestamp: now,
          },
        ],
        updatedAt: now,
      };

      await repo.updateCorrectionRequest(updated, { clearPendingOnRecord: true });
      res.json({ request: updated });
    }
  );

  app.post(
    '/api/corrections/:id/review',
    requireAuth,
    requireRoles('faculty', 'admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const reviewer = req.user!;
      const policy = await repo.getPolicy();

      if (!policy.approvalPermissions.includes(reviewer.role)) {
        res.status(403).json({
          error: `Current institutional policy restricts correction decisions to: ${policy.approvalPermissions.join(', ')}.`,
        });
        return;
      }

      const existing = await repo.getCorrectionById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Correction request not found.' });
        return;
      }

      const subjects = await repo.getSubjects();
      const subj = subjects.find((s) => s.id === existing.subjectId);
      const cls = await repo.getClassById(existing.classId);
      if (!subj) {
        res.status(404).json({ error: 'Subject record not found.' });
        return;
      }

      const assignments = await repo.getFacultyAssignments();
      if (
        reviewer.role === 'faculty' &&
        !isFacultyAuthorizedForPair(
          reviewer.id,
          existing.sectionId,
          existing.subjectId,
          assignments,
          cls
        )
      ) {
        res.status(403).json({
          error:
            'Faculty reviewers may only act on correction requests for their assigned section and subject.',
        });
        return;
      }

      const { decision, decisionReason } = req.body as {
        decision?: 'Under Review' | 'Additional Evidence Requested' | 'Approved' | 'Rejected';
        decisionReason?: string;
      };

      if (
        !decision ||
        !['Under Review', 'Additional Evidence Requested', 'Approved', 'Rejected'].includes(
          decision
        )
      ) {
        res.status(400).json({ error: 'Valid review decision is required.' });
        return;
      }

      const record = await repo.getRecordById(existing.attendanceRecordId);
      if (!record) {
        res.status(404).json({ error: 'Underlying attendance record not found.' });
        return;
      }

      const now = new Date().toISOString();
      const reasonText =
        decisionReason?.trim() ||
        (decision === 'Approved'
          ? 'Evidence verified'
          : decision === 'Rejected'
            ? 'Evidence rejected'
            : decision === 'Additional Evidence Requested'
              ? 'Additional document required'
              : 'Under review');

      const updatedReq: AttendanceCorrectionRequest = {
        ...existing,
        workflowStatus: decision,
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
        decisionReason: reasonText,
        timeline: [
          ...existing.timeline,
          {
            status: decision,
            actorName: reviewer.name,
            actorRole: reviewer.role,
            note: reasonText,
            timestamp: now,
          },
        ],
        updatedAt: now,
      };

      const evidenceRef =
        existing.evidenceFiles.map((f) => `${f.originalName} (${f.id})`).join(', ') ||
        'No uploaded file';

      if (decision === 'Approved') {
        const prevVersion = record.correctionVersion;
        const nextVersion = prevVersion + 1;
        const newStatus = existing.requestedStatus === 'Excused' ? 'Excused' : 'Corrected';

        const updatedRecord: AttendanceRecord = {
          ...record,
          status: newStatus,
          effectivePresent: true,
          recordSource: 'Approved Correction',
          correctionVersion: nextVersion,
          pendingRequestId: undefined,
        };

        const auditLog: AttendanceAuditLog = {
          id: `aud-${Date.now()}`,
          category: 'CORRECTION_WORKFLOW',
          attendanceRecordId: record.id,
          sectionId: existing.sectionId,
          sectionDisplayName: existing.sectionDisplayName,
          subjectId: subj.id,
          subjectCode: subj.code,
          subjectName: subj.name,
          classId: existing.classId,
          classDate: existing.classDate,
          classPeriod: existing.classPeriod,
          studentId: existing.studentId,
          studentName: existing.studentName,
          studentIdentifier: existing.studentIdentifier,
          previousValue: record.status,
          newValue: newStatus === 'Excused' ? 'Excused (Approved)' : 'Corrected (Present)',
          previousVersion: prevVersion,
          newVersion: nextVersion,
          action: 'CORRECTION_APPROVED',
          actorId: reviewer.id,
          actorName: reviewer.name,
          actorRole: reviewer.role,
          correctionRequestId: existing.id,
          correctionReferenceNumber: existing.referenceNumber,
          reason: reasonText,
          evidenceReference: evidenceRef,
          timestamp: now,
        };

        await repo.updateCorrectionRequest(updatedReq, {
          updatedAttendanceRecord: updatedRecord,
          auditLog,
          notification: {
            id: `notif-${Date.now()}`,
            recipientId: existing.studentId,
            type: 'CORRECTION_UPDATE',
            title: 'Your attendance record has been updated following approval',
            message: `${reviewer.name} approved ${existing.referenceNumber} for ${subj.code} (${existing.classDate}). Subject attendance has been recalculated.`,
            relatedRecordId: existing.id,
            targetNav: 'corrections',
            read: false,
            timestamp: now,
          },
        });

        res.json({ request: updatedReq });
        return;
      }

      if (decision === 'Rejected') {
        const auditLog: AttendanceAuditLog = {
          id: `aud-${Date.now()}`,
          category: 'CORRECTION_WORKFLOW',
          attendanceRecordId: record.id,
          sectionId: existing.sectionId,
          sectionDisplayName: existing.sectionDisplayName,
          subjectId: subj.id,
          subjectCode: subj.code,
          subjectName: subj.name,
          classId: existing.classId,
          classDate: existing.classDate,
          classPeriod: existing.classPeriod,
          studentId: existing.studentId,
          studentName: existing.studentName,
          studentIdentifier: existing.studentIdentifier,
          previousValue: record.status,
          newValue: `${record.status} (Unchanged — Correction Rejected)`,
          previousVersion: record.correctionVersion,
          newVersion: record.correctionVersion,
          action: 'CORRECTION_REJECTED',
          actorId: reviewer.id,
          actorName: reviewer.name,
          actorRole: reviewer.role,
          correctionRequestId: existing.id,
          correctionReferenceNumber: existing.referenceNumber,
          reason: reasonText,
          evidenceReference: evidenceRef,
          timestamp: now,
        };

        await repo.updateCorrectionRequest(updatedReq, {
          clearPendingOnRecord: true,
          auditLog,
          notification: {
            id: `notif-${Date.now()}`,
            recipientId: existing.studentId,
            type: 'CORRECTION_UPDATE',
            title: `Decision recorded on ${existing.referenceNumber}`,
            message: `${reviewer.name} reviewed your ${subj.code} request (${existing.classDate}): Rejected. Original attendance remains unchanged.`,
            relatedRecordId: existing.id,
            targetNav: 'corrections',
            read: false,
            timestamp: now,
          },
        });

        res.json({ request: updatedReq });
        return;
      }

      if (decision === 'Additional Evidence Requested') {
        const auditLog: AttendanceAuditLog = {
          id: `aud-${Date.now()}`,
          category: 'CORRECTION_WORKFLOW',
          attendanceRecordId: record.id,
          sectionId: existing.sectionId,
          sectionDisplayName: existing.sectionDisplayName,
          subjectId: subj.id,
          subjectCode: subj.code,
          subjectName: subj.name,
          classId: existing.classId,
          classDate: existing.classDate,
          classPeriod: existing.classPeriod,
          studentId: existing.studentId,
          studentName: existing.studentName,
          studentIdentifier: existing.studentIdentifier,
          previousValue: record.status,
          newValue: `${record.status} (Unchanged — Evidence Requested)`,
          previousVersion: record.correctionVersion,
          newVersion: record.correctionVersion,
          action: 'EVIDENCE_REQUESTED',
          actorId: reviewer.id,
          actorName: reviewer.name,
          actorRole: reviewer.role,
          correctionRequestId: existing.id,
          correctionReferenceNumber: existing.referenceNumber,
          reason: reasonText,
          evidenceReference: evidenceRef,
          timestamp: now,
        };

        await repo.updateCorrectionRequest(updatedReq, {
          auditLog,
          notification: {
            id: `notif-${Date.now()}`,
            recipientId: existing.studentId,
            type: 'CORRECTION_UPDATE',
            title: 'The faculty reviewer has requested additional evidence',
            message: `${reviewer.name} requested clarification on ${existing.referenceNumber} (${subj.code}): "${reasonText}"`,
            relatedRecordId: existing.id,
            targetNav: 'corrections',
            read: false,
            timestamp: now,
          },
        });

        res.json({ request: updatedReq });
        return;
      }

      await repo.updateCorrectionRequest(updatedReq);
      res.json({ request: updatedReq });
    }
  );

  app.get(
    '/api/evidence/:requestId/:fileId',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const viewer = req.user!;
      const corr = await repo.getCorrectionById(req.params.requestId);
      if (!corr) {
        res.status(404).json({ error: 'Correction request not found.' });
        return;
      }

      if (viewer.role === 'student' && corr.studentId !== viewer.id) {
        res.status(403).json({
          error: 'Unauthorized: Students may only view their own uploaded documents.',
        });
        return;
      }
      if (viewer.role === 'faculty') {
        const assignments = await repo.getFacultyAssignments();
        const cls = await repo.getClassById(corr.classId);
        if (
          !isFacultyAuthorizedForPair(
            viewer.id,
            corr.sectionId,
            corr.subjectId,
            assignments,
            cls
          )
        ) {
          res.status(403).json({
            error: 'Unauthorized: Faculty may only inspect evidence for assigned sections and subjects.',
          });
          return;
        }
      }

      const fileMeta = corr.evidenceFiles.find((f) => f.id === req.params.fileId);
      if (!fileMeta) {
        res.status(404).json({ error: 'Requested evidence document was not found.' });
        return;
      }

      const safeFileName = path.basename(fileMeta.storedName);
      const fullPath = path.join(repo.getUploadDir(), safeFileName);
      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: 'Evidence file is missing from private storage.' });
        return;
      }

      await repo.recordEvidenceAccess(corr.id, viewer, fileMeta.originalName);
      res.setHeader('Content-Type', fileMeta.mimeType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${fileMeta.originalName.replace(/"/g, '')}"`
      );
      fs.createReadStream(fullPath).pipe(res);
    }
  );

  app.post(
    '/api/notifications/mark-read',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const { notificationId } = req.body as { notificationId?: string };
      await repo.markNotificationsRead(req.user!.id, notificationId);
      res.json({ ok: true });
    }
  );

  // ============================================================================
  // SECURE TIME-BOUND & LOCATION-VERIFIED QR ATTENDANCE API
  // ============================================================================

  // Faculty/Admin creates a new Dynamic QR Attendance Session
  app.post(
    '/api/qr-sessions',
    requireAuth,
    requireRoles('faculty', 'admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const actor = req.user!;
      const {
        sectionId,
        subjectId,
        durationMinutes,
        classroom,
        hostLatitude,
        hostLongitude,
        hostAccuracy,
      } = req.body as {
        sectionId?: string;
        subjectId?: string;
        durationMinutes?: number;
        classroom?: string;
        hostLatitude?: number;
        hostLongitude?: number;
        hostAccuracy?: number;
      };

      if (!sectionId || !subjectId) {
        res.status(400).json({ error: 'Section ID and Subject ID are required.' });
        return;
      }

      if (
        hostLatitude === undefined ||
        hostLongitude === undefined ||
        isNaN(Number(hostLatitude)) ||
        isNaN(Number(hostLongitude))
      ) {
        res.status(400).json({
          error:
            'Teacher host device GPS coordinates are mandatory. Cannot start attendance session without verified host location.',
        });
        return;
      }

      // Authorization check: faculty must be assigned to this section and subject
      if (actor.role === 'faculty') {
        const assignments = await repo.getFacultyAssignments();
        if (!isFacultyAuthorizedForPair(actor.id, sectionId, subjectId, assignments)) {
          res.status(403).json({
            error: 'You are not assigned to teach this section and subject.',
          });
          return;
        }
      }

      try {
        const session = await repo.createQrSession({
          sectionId,
          subjectId,
          faculty: actor,
          durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
          classroom,
          hostLatitude: Number(hostLatitude),
          hostLongitude: Number(hostLongitude),
          hostAccuracy: hostAccuracy !== undefined ? Number(hostAccuracy) : undefined,
        });
        res.status(201).json({ session });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // List QR Sessions for current user
  app.get('/api/qr-sessions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    if (user.role === 'faculty') {
      const sessions = await repo.listQrSessions(user.id);
      res.json({ sessions });
      return;
    }
    if (user.role === 'admin') {
      const sessions = await repo.listQrSessions();
      res.json({ sessions });
      return;
    }
    // Student: list active sessions for their section (mask token for student)
    const mySectionId = user.sectionId || '';
    const all = await repo.listQrSessions();
    const visible = all
      .filter(
        (s) => s.sectionId === mySectionId && (s.status === 'ACTIVE' || s.date === new Date().toISOString().split('T')[0])
      )
      .map((s) => ({
        ...s,
        currentQrToken: '',
      }));
    res.json({ sessions: visible });
  });

  // Get single QR Session detail + attempts
  app.get('/api/qr-sessions/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    const session = await repo.getQrSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Attendance session not found.' });
      return;
    }

    const user = req.user!;
    if (user.role === 'student' && user.sectionId !== session.sectionId) {
      res.status(403).json({ error: 'You are not enrolled in the section for this session.' });
      return;
    }
    if (user.role === 'faculty' && session.facultyId !== user.id) {
      res.status(403).json({ error: 'You are not the conducting faculty for this session.' });
      return;
    }

    const attempts = await repo.listAttendanceAttempts(session.id);
    const verifications = await repo.listRandomVerifications(session.id);
    const sessionResponse = user.role === 'student' ? { ...session, currentQrToken: '' } : session;
    res.json({ session: sessionResponse, attempts, verifications });
  });

  // Refresh dynamic QR code token (called every 5 seconds by teacher UI)
  app.post(
    '/api/qr-sessions/:id/refresh-token',
    requireAuth,
    requireRoles('faculty', 'admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      try {
        const result = await repo.refreshQrToken(req.params.id, req.user!.id);
        res.json(result);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // Close QR attendance session manually
  app.post(
    '/api/qr-sessions/:id/close',
    requireAuth,
    requireRoles('faculty', 'admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const session = await repo.closeQrSession(req.params.id, req.user!.id);
        res.json({ session });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // Student scans QR code and submits attendance with GPS & device fingerprint
  app.post(
    '/api/qr-attendance/scan',
    requireAuth,
    requireRoles('student'),
    async (req: AuthenticatedRequest, res: Response) => {
      const student = req.user!;
      const {
        sessionId,
        qrToken,
        latitude,
        longitude,
        accuracy,
        deviceFingerprint,
        devicePlatform,
        browserName,
      } = req.body as {
        sessionId?: string;
        qrToken?: string;
        latitude?: number;
        longitude?: number;
        accuracy?: number;
        deviceFingerprint?: string;
        devicePlatform?: string;
        browserName?: string;
      };

      if (!sessionId || !qrToken) {
        res.status(400).json({
          success: false,
          classification: 'REJECTED',
          message: 'Session identifier and scanned QR token are required.',
        });
        return;
      }

      if (
        latitude === undefined ||
        longitude === undefined ||
        isNaN(Number(latitude)) ||
        isNaN(Number(longitude)) ||
        (Number(latitude) === 0 && Number(longitude) === 0)
      ) {
        res.status(400).json({
          success: false,
          classification: 'REJECTED',
          message: 'Location permission denied or GPS unavailable. Actual GPS coordinates are required.',
        });
        return;
      }

      try {
        const result = await repo.submitQrAttendanceAttempt({
          sessionId,
          qrToken: String(qrToken).trim(),
          student,
          latitude: Number(latitude),
          longitude: Number(longitude),
          accuracy: Number(accuracy || 9999),
          deviceFingerprint: String(deviceFingerprint || 'unknown-device').trim(),
          devicePlatform: String(devicePlatform || 'Web Mobile Browser').trim(),
          browserName: String(browserName || 'Standard Browser').trim(),
        });

        res.json(result);
      } catch (err) {
        res.status(500).json({
          success: false,
          classification: 'REJECTED',
          message: err instanceof Error ? err.message : 'Server error during attendance verification.',
        });
      }
    }
  );

  // Trigger random in-class verification challenge (Faculty)
  app.post(
    '/api/qr-sessions/:id/random-verify',
    requireAuth,
    requireRoles('faculty', 'admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const verifications = await repo.triggerRandomVerification(
          req.params.id,
          req.user!.id,
          req.body.count ? Number(req.body.count) : 3
        );
        res.status(201).json({ verifications });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // Student responds to random challenge
  app.post(
    '/api/random-verify/respond',
    requireAuth,
    requireRoles('student'),
    async (req: AuthenticatedRequest, res: Response) => {
      const { challengeId, code } = req.body as { challengeId?: string; code?: string };
      if (!challengeId || !code) {
        res.status(400).json({ error: 'Challenge ID and 4-digit code are required.' });
        return;
      }
      try {
        const result = await repo.respondRandomVerification(challengeId, req.user!.id, code);
        res.json(result);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // Student retrieves their device binding status
  app.get(
    '/api/device-binding/my',
    requireAuth,
    requireRoles('student'),
    async (req: AuthenticatedRequest, res: Response) => {
      const binding = await repo.getDeviceBindingByStudent(req.user!.id);
      res.json({ binding });
    }
  );

  // Student requests device change
  app.post(
    '/api/device-binding/request-change',
    requireAuth,
    requireRoles('student'),
    async (req: AuthenticatedRequest, res: Response) => {
      const { reason, newFingerprint, devicePlatform, browserName } = req.body as {
        reason?: string;
        newFingerprint?: string;
        devicePlatform?: string;
        browserName?: string;
      };

      if (!reason || !newFingerprint) {
        res.status(400).json({ error: 'Reason for device change and new device fingerprint are required.' });
        return;
      }

      const user = req.user!;
      const existing = await repo.getDeviceBindingByStudent(user.id);
      const updatedBinding = await repo.registerDeviceBinding({
        id: existing?.id || `dev-bind-${user.id}`,
        studentId: user.id,
        studentName: user.name,
        studentIdentifier: user.identifier,
        sectionDisplayName: user.sectionDisplayName,
        deviceFingerprint: newFingerprint,
        devicePlatform: devicePlatform || 'Mobile Browser',
        browserName: browserName || 'Chrome/Safari',
        status: 'Pending_Approval',
        registeredAt: existing?.registeredAt || new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        changeReason: reason,
        requestedAt: new Date().toISOString(),
      });

      res.json({ binding: updatedBinding, message: 'Device change request submitted for administrator review.' });
    }
  );

  // Administrator attendance monitoring dashboard data
  app.get(
    '/api/admin/qr-monitoring',
    requireAuth,
    requireRoles('admin'),
    async (_req: AuthenticatedRequest, res: Response) => {
      const policy = await repo.getPolicy();
      const allSessions = await repo.listQrSessions();
      const activeSessions = allSessions.filter((s) => s.status === 'ACTIVE');
      const recentSessions = allSessions.slice(0, 20);
      const attempts = await repo.getAllAttendanceAttempts();
      const deviceBindings = await repo.listDeviceBindings();

      res.json({
        policy,
        activeSessions,
        recentSessions,
        attempts: attempts.slice(0, 50),
        deviceBindings,
      });
    }
  );

  // Admin reviews device binding
  app.post(
    '/api/admin/device-bindings/:id/review',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const { status, reviewNotes } = req.body as {
        status?: 'Approved' | 'Rejected';
        reviewNotes?: string;
      };
      if (!status || !['Approved', 'Rejected'].includes(status)) {
        res.status(400).json({ error: 'Status must be Approved or Rejected.' });
        return;
      }
      try {
        const binding = await repo.updateDeviceBindingStatus(req.params.id, status, reviewNotes, req.user);
        res.json({ binding });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // Admin resets student device binding
  app.post(
    '/api/admin/device-bindings/:studentId/reset',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        await repo.resetDeviceBinding(req.params.studentId, req.user);
        res.json({ ok: true, message: 'Student device binding reset successfully.' });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // Admin updates campus GPS coordinates, radius, accuracy, and timers
  app.post(
    '/api/admin/policy/location',
    requireAuth,
    requireRoles('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const {
        campusLatitude,
        campusLongitude,
        permittedRadiusMeters,
        teacherHostRadiusMeters,
        maxAcceptableGpsAccuracyMeters,
        qrRefreshSeconds,
        defaultSessionDurationMinutes,
        randomVerificationWindowMinutes,
        enforceDeviceRegistration,
      } = req.body as {
        campusLatitude?: number;
        campusLongitude?: number;
        permittedRadiusMeters?: number;
        teacherHostRadiusMeters?: number;
        maxAcceptableGpsAccuracyMeters?: number;
        qrRefreshSeconds?: number;
        defaultSessionDurationMinutes?: number;
        randomVerificationWindowMinutes?: number;
        enforceDeviceRegistration?: boolean;
      };

      if (campusLatitude !== undefined && (isNaN(Number(campusLatitude)) || Number(campusLatitude) < -90 || Number(campusLatitude) > 90)) {
        res.status(400).json({ error: 'Invalid campus latitude (must be between -90 and 90).' });
        return;
      }
      if (campusLongitude !== undefined && (isNaN(Number(campusLongitude)) || Number(campusLongitude) < -180 || Number(campusLongitude) > 180)) {
        res.status(400).json({ error: 'Invalid campus longitude (must be between -180 and 180).' });
        return;
      }
      if (
        teacherHostRadiusMeters !== undefined &&
        (isNaN(Number(teacherHostRadiusMeters)) ||
          Number(teacherHostRadiusMeters) < 10 ||
          Number(teacherHostRadiusMeters) > 15)
      ) {
        res.status(400).json({
          error: 'Teacher host proximity radius must be strictly between 10 and 15 meters.',
        });
        return;
      }

      try {
        const updated = await repo.updatePolicy(
          {
            campusLatitude: campusLatitude !== undefined ? Number(campusLatitude) : undefined,
            campusLongitude: campusLongitude !== undefined ? Number(campusLongitude) : undefined,
            permittedRadiusMeters:
              permittedRadiusMeters !== undefined ? Number(permittedRadiusMeters) : undefined,
            teacherHostRadiusMeters:
              teacherHostRadiusMeters !== undefined ? Number(teacherHostRadiusMeters) : undefined,
            maxAcceptableGpsAccuracyMeters:
              maxAcceptableGpsAccuracyMeters !== undefined
                ? Number(maxAcceptableGpsAccuracyMeters)
                : undefined,
            qrRefreshSeconds:
              qrRefreshSeconds !== undefined ? Number(qrRefreshSeconds) : undefined,
            defaultSessionDurationMinutes:
              defaultSessionDurationMinutes !== undefined
                ? Number(defaultSessionDurationMinutes)
                : undefined,
            randomVerificationWindowMinutes:
              randomVerificationWindowMinutes !== undefined
                ? Number(randomVerificationWindowMinutes)
                : undefined,
            enforceDeviceRegistration:
              enforceDeviceRegistration !== undefined
                ? Boolean(enforceDeviceRegistration)
                : undefined,
            policyLastVerifiedNote: 'VTU Jnana Sangama Campus GPS Geofence & QR Timers Updated',
          },
          req.user!
        );
        res.json({ policy: updated, message: 'Campus geofence and QR policies updated successfully.' });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.post('/api/demo/reset', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
    await repo.resetDemoData();
    res.json({ ok: true });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[VTU Smart Attendance] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
