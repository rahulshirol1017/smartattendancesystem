import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
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
  RecordSource,
  StudentDeviceBinding,
  SubjectItem,
  TimetableEntry,
  UserProfile,
} from '../src/shared/types.ts';

export interface StoredUser extends UserProfile {
  passwordHash: string;
}

export interface SeedDatabaseBundle {
  schemaVersion: number;
  policy: InstitutionalPolicy;
  sections: AcademicSection[];
  users: StoredUser[];
  subjects: SubjectItem[];
  facultyAssignments: FacultyAssignment[];
  classes: ClassSession[];
  records: AttendanceRecord[];
  corrections: AttendanceCorrectionRequest[];
  auditLogs: AttendanceAuditLog[];
  timetable: TimetableEntry[];
  notifications: AppNotification[];
  qrSessions: QRAttendanceSession[];
  deviceBindings: StudentDeviceBinding[];
  attendanceAttempts: AttendanceSubmissionAttempt[];
  randomVerifications: RandomInClassVerification[];
}

export const CURRENT_SEED_SCHEMA_VERSION = 8;

const SUBJECT_TOPICS: Record<string, string[]> = {
  BCB501: [
    'Principles of Management & Organizational Functions',
    'Planning Process, Strategic Objectives & Decision Making',
    'Organizational Structure, Delegation & Span of Control',
    'Motivation Theories, Leadership Styles & Communication',
    'Controlling Operations, Budgeting & Quality Assurance',
    'Corporate Governance & Business Ethics',
  ],
  BCS502: [
    'OSI & TCP/IP Protocol Architecture',
    'Data Link Layer Framing & CRC Error Detection',
    'Sliding Window Protocols & IEEE 802.11 MAC',
    'IPv4 Addressing, Subnetting & CIDR Routing',
    'Distance Vector & OSPF Link-State Routing',
    'TCP Connection Management & Congestion Control',
  ],
  BCS503: [
    'Deterministic & Non-Deterministic Finite Automata',
    'Regular Expressions, Pumping Lemma & Closure Properties',
    'Context-Free Grammars, Parse Trees & Ambiguity',
    'Pushdown Automata & CFL Equivalence',
    'Chomsky Normal Form & CYK Membership',
    'Turing Machines, Decidability & Halting Problem',
  ],
  BCBL504: [
    'Descriptive Statistics & Exploratory Data Visualization',
    'Probability Distributions & Sampling Experiments',
    'Hypothesis Testing: t-Test, z-Test & Chi-Square',
    'One-Way & Two-Way ANOVA Lab Implementation',
    'Simple & Multiple Linear Regression Modeling',
    'Non-Parametric Tests & Time-Series Diagnostics',
  ],
  BCS515D: [
    'Distributed System Models, Transparency & Scalability',
    'Interprocess Communication, RPC & Remote Invocation',
    'Logical Clocks: Lamport & Vector Timestamps',
    'Global State Recording & Chandy-Lamport Snapshot',
    'Distributed Mutual Exclusion & Leader Election',
    'Consensus, Replication & Two-Phase Commit',
  ],
  BCB586: [
    'Problem Statement Formulation & Literature Survey',
    'System Requirements & Architecture Specification',
    'Database Schema & Module Interface Design',
    'Core Prototype Implementation & Code Review',
    'Integration Testing & Dataset Validation',
    'Demonstration & Mid-Semester Progress Evaluation',
  ],
  BRMK557: [
    'Meaning, Objectives & Types of Engineering Research',
    'Literature Review, Citation Ethics & Problem Formulation',
    'Research Design, Sampling & Data Collection',
    'Technical Report Writing & Publication Standards',
    'Intellectual Property Rights: Patents, Copyrights & Trademarks',
    'Patent Filing Procedure, Prior Art Search & Licensing',
  ],
  BCS508: [
    'Ecosystems, Biodiversity & Natural Resource Conservation',
    'Environmental Pollution Monitoring & Control Standards',
    'Solid Waste Management & Hazardous Material Regulations',
    'E-Waste Composition, Classification & Recycling Lifecycle',
    'Extended Producer Responsibility & E-Waste Rules in India',
    'Sustainable Green Computing & Circular Economy Practices',
  ],
  BNSK559: [
    'NSS Community Outreach & Campus Cleanliness Drive',
    'Physical Conditioning & Endurance Assessment',
    'Pranayama, Surya Namaskara & Posture Alignment',
    'Digital Literacy & Environmental Awareness Camp',
  ],
};

export function ensureSampleEvidenceFiles(uploadDir: string): void {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const files = [
    {
      name: 'vtu_csbs_medical_certificate_oct14.pdf',
      content: `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 282 >> stream
BT
/F1 14 Tf
50 720 Td
(VTU HEALTH CENTRE - BELAGAVI MEDICAL CERTIFICATE) Tj
/F1 11 Tf
0 -28 Td
(Course: BCS502 - Computer Networks | Date: 2026-10-15 | Slot: 09:00-10:00) Tj
0 -20 Td
(Student USN: 2VX24CB001 - Rahul Kulkarni | Section: CSBS A | Room: VB G19) Tj
0 -20 Td
(Document Type: Signed Medical Certificate - Verified Outpatient Treatment) Tj
ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000575 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
643
%%EOF`,
    },
    {
      name: 'vtu_csbs_lab_register_oct09.pdf',
      content: `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 276 >> stream
BT
/F1 14 Tf
50 720 Td
(DEPT OF CSE - VTU BELAGAVI LAB ATTENDANCE EXTRACT) Tj
/F1 11 Tf
0 -28 Td
(Course: BCBL504 - Computational Statistics Lab | Date: 2026-10-06 | 11:15-01:15) Tj
0 -20 Td
(Student USN: 2VX24CB001 - Rahul Kulkarni | Batch B1 | Old Re Lab) Tj
0 -20 Td
(Counter-signed Lab Register Entry: PRESENT) Tj
ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000569 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
637
%%EOF`,
    },
  ];

  for (const f of files) {
    const filePath = path.join(uploadDir, f.name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, f.content, 'utf8');
    }
  }
}

export function buildInitialSeedData(): SeedDatabaseBundle {
  const demoPasswordHash = bcrypt.hashSync('DemoPass@2026', 10);

  const policy: InstitutionalPolicy = {
    id: 'policy-vtu-2026',
    institutionName:
      'Department of Computer Science and Engineering · Jnana Sangama, VTU Campus, Belagavi',
    academicYear: '2026',
    semester: 5,
    programme: 'B.Tech in Computer Science and Business Systems (CSBS)',
    defaultMinimumPercentage: 85,
    warningBufferPercentage: 5,
    calculationMethod: 'simple_count',
    cancelledClassPolicy: 'exclude_from_conducted',
    excusedAbsencePolicy: 'count_as_attended',
    approvalPermissions: ['faculty', 'admin'],
    evidenceRequiredForSubmission: true,
    maxEvidenceSizeMB: 5,
    allowedEvidenceTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    allowAppeals: true,
    appealWindowDays: 7,
    allowFacultyExtraClassRequests: true,
    enforceRoomConflictCheck: true,
    campusLatitude: 15.8858,
    campusLongitude: 74.5298,
    permittedRadiusMeters: 350,
    teacherHostRadiusMeters: 15,
    maxAcceptableGpsAccuracyMeters: 80,
    qrRefreshSeconds: 5,
    defaultSessionDurationMinutes: 5,
    randomVerificationWindowMinutes: 3,
    enforceDeviceRegistration: false,
    policyLastVerifiedNote: 'V-Semester CSBS Timetable w.e.f. 07/09/2026 · Time & Location Verified QR Attendance',
    updatedAt: '2026-09-07T09:00:00Z',
  };

  // ============================================================================
  // 1. OFFICIAL ACADEMIC SECTIONS (ONLY CSBS A & CSBS B FROM PDF)
  // ============================================================================
  const sections: AcademicSection[] = [
    {
      id: 'sec-csbs-a',
      department: 'CSBS',
      sectionName: 'A',
      displayName: 'CSBS A',
      semester: 5,
      academicYear: '2026',
      programme: 'B.Tech in Computer Science and Business Systems',
      defaultClassroom: 'VB G19',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'sec-csbs-b',
      department: 'CSBS',
      sectionName: 'B',
      displayName: 'CSBS B',
      semester: 5,
      academicYear: '2026',
      programme: 'B.Tech in Computer Science and Business Systems',
      defaultClassroom: 'VB G17',
      status: 'Active',
      isDemo: true,
    },
  ];

  // ============================================================================
  // 2. USERS: 4 GENUINE CSBS B STUDENTS, 10 OFFICIAL CSBS FACULTY, 1 ADMIN
  // ============================================================================
  const users: StoredUser[] = [
    // Genuine Student Identities: 2VX24CB067, 2VX24CB069, 2VX24CB070, 2VX24CB072 (CSBS Section B)
    {
      id: 'stu-csbsb-067',
      name: 'PUTTRAJ GALAGI',
      identifier: '2VX24CB067',
      email: '2vx24cb067@vtu.ac.in',
      role: 'student',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'B.Tech in Computer Science and Business Systems',
      semester: 5,
      section: 'B',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      academicYear: '2026',
      rollNumber: '67',
      accountStatus: 'Active',
      isDemo: false,
      isRegistered: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'stu-csbsb-069',
      name: 'RAHUL SHIROL',
      identifier: '2VX24CB069',
      email: 'rshirol958@gmail.com',
      role: 'student',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'B.Tech in Computer Science and Business Systems',
      semester: 5,
      section: 'B',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      academicYear: '2026',
      rollNumber: '69',
      accountStatus: 'Active',
      isDemo: false,
      isRegistered: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'stu-csbsb-070',
      name: 'RAKESH NAIK',
      identifier: '2VX24CB070',
      email: '2vx24cb070@vtu.ac.in',
      role: 'student',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'B.Tech in Computer Science and Business Systems',
      semester: 5,
      section: 'B',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      academicYear: '2026',
      rollNumber: '70',
      accountStatus: 'Active',
      isDemo: false,
      isRegistered: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'stu-csbsb-072',
      name: 'RAMAPPA NAIK',
      identifier: '2VX24CB072',
      email: '2vx24cb072@vtu.ac.in',
      role: 'student',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'B.Tech in Computer Science and Business Systems',
      semester: 5,
      section: 'B',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      academicYear: '2026',
      rollNumber: '72',
      accountStatus: 'Active',
      isDemo: false,
      isRegistered: true,
      passwordHash: demoPasswordHash,
    },

    // 10 Official V-Semester CSBS Faculty Members (from VTU Belagavi Timetable PDF)
    {
      id: 'fac-harish',
      name: 'Mr. Harish Kamble',
      identifier: 'FAC-CSBS-01',
      email: 'harish.kamble@vtu.ac.in',
      role: 'faculty',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'Department of Computer Science and Engineering',
      semester: 5,
      section: 'All',
      designation: 'Faculty',
      unavailableSlots: [],
      accountStatus: 'Active',
      isDemo: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'fac-rohit',
      name: 'Dr. Rohit B Kaliwal',
      identifier: 'FAC-CSBS-02',
      email: 'rohit.kaliwal@vtu.ac.in',
      role: 'faculty',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'Department of Computer Science and Engineering',
      semester: 5,
      section: 'All',
      designation: 'Associate Professor',
      unavailableSlots: [],
      accountStatus: 'Active',
      isDemo: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'fac-shreeta',
      name: 'Ms. Shreeta',
      identifier: 'FAC-CSBS-03',
      email: 'shreeta@vtu.ac.in',
      role: 'faculty',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'Department of Computer Science and Engineering',
      semester: 5,
      section: 'All',
      designation: 'Faculty',
      unavailableSlots: [],
      accountStatus: 'Active',
      isDemo: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'fac-anita',
      name: 'Mrs. Anita K',
      identifier: 'FAC-CSBS-04',
      email: 'anita.k@vtu.ac.in',
      role: 'faculty',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'Department of Computer Science and Engineering',
      semester: 5,
      section: 'All',
      designation: 'Faculty',
      unavailableSlots: [],
      accountStatus: 'Active',
      isDemo: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'fac-deshpande',
      name: 'Dr. S L Deshpande',
      identifier: 'FAC-CSBS-05',
      email: 'sl.deshpande@vtu.ac.in',
      role: 'faculty',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'Department of Computer Science and Engineering',
      semester: 5,
      section: 'All',
      designation: 'Professor & Chairperson',
      unavailableSlots: [],
      accountStatus: 'Active',
      isDemo: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'fac-goudar',
      name: 'Dr. R H Goudar',
      identifier: 'FAC-CSBS-06',
      email: 'rh.goudar@vtu.ac.in',
      role: 'faculty',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'Department of Computer Science and Engineering',
      semester: 5,
      section: 'All',
      designation: 'Professor',
      unavailableSlots: [],
      accountStatus: 'Active',
      isDemo: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'fac-chinmay',
      name: 'Mr. Chinmay',
      identifier: 'FAC-CSBS-07',
      email: 'chinmay@vtu.ac.in',
      role: 'faculty',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'Department of Computer Science and Engineering',
      semester: 5,
      section: 'A',
      designation: 'Faculty',
      unavailableSlots: [],
      accountStatus: 'Active',
      isDemo: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'fac-vinaykumar',
      name: 'Mr. Vinaykumar. H',
      identifier: 'FAC-CSBS-08',
      email: 'vinaykumar.h@vtu.ac.in',
      role: 'faculty',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'Department of Computer Science and Engineering',
      semester: 5,
      section: 'B',
      designation: 'Faculty',
      unavailableSlots: [],
      accountStatus: 'Active',
      isDemo: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'fac-archana',
      name: 'Mrs. Archana H',
      identifier: 'FAC-CSBS-09',
      email: 'archana.h@vtu.ac.in',
      role: 'faculty',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'Department of Computer Science and Engineering',
      semester: 5,
      section: 'All',
      designation: 'Faculty',
      unavailableSlots: [],
      accountStatus: 'Active',
      isDemo: true,
      passwordHash: demoPasswordHash,
    },
    {
      id: 'fac-iranna',
      name: 'Mr. Iranna T',
      identifier: 'FAC-CSBS-10',
      email: 'iranna.t@vtu.ac.in',
      role: 'faculty',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'Department of Computer Science and Engineering',
      semester: 5,
      section: 'All',
      designation: 'NSS / PE / Yoga Coordinator',
      unavailableSlots: [],
      accountStatus: 'Active',
      isDemo: true,
      passwordHash: demoPasswordHash,
    },

    // Department Academic Administrator
    {
      id: 'adm-vtu-01',
      name: 'VTU CSE-CSBS Office',
      identifier: 'ADM-VTU-01',
      email: 'office.csbs@vtu.ac.in',
      role: 'admin',
      college: 'VTU Campus, Jnana Sangama, Belagavi',
      department: 'CSBS',
      programme: 'Department Administration',
      semester: 5,
      section: 'All',
      designation: 'Department Timetable & Attendance Coordinator',
      accountStatus: 'Active',
      isDemo: true,
      passwordHash: demoPasswordHash,
    },
  ];

  // ============================================================================
  // 3. OFFICIAL V-SEMESTER CSBS COURSES (9 COURSES FROM PDF)
  // ============================================================================
  const subjects: SubjectItem[] = [
    {
      id: 'sub-bcb501',
      code: 'BCB501',
      name: 'Fundamentals of Management',
      department: 'CSBS',
      semester: 5,
      programme: 'B.Tech in Computer Science and Business Systems',
      credits: 3,
      attendanceRequirement: 85,
      assignedFacultyId: 'fac-harish',
      assignedFacultyName: 'Mr. Harish Kamble',
      academicYear: '2026',
      estimatedRemainingClasses: 18,
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'sub-bcs502',
      code: 'BCS502',
      name: 'Computer Networks',
      department: 'CSBS',
      semester: 5,
      programme: 'B.Tech in Computer Science and Business Systems',
      credits: 4,
      attendanceRequirement: 85,
      assignedFacultyId: 'fac-rohit',
      assignedFacultyName: 'Dr. Rohit B Kaliwal',
      academicYear: '2026',
      estimatedRemainingClasses: 20,
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'sub-bcs503',
      code: 'BCS503',
      name: 'Theory of Computation',
      department: 'CSBS',
      semester: 5,
      programme: 'B.Tech in Computer Science and Business Systems',
      credits: 4,
      attendanceRequirement: 85,
      assignedFacultyId: 'fac-shreeta',
      assignedFacultyName: 'Ms. Shreeta',
      academicYear: '2026',
      estimatedRemainingClasses: 20,
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'sub-bcbl504',
      code: 'BCBL504',
      name: 'Computational Statistics Lab',
      department: 'CSBS',
      semester: 5,
      programme: 'B.Tech in Computer Science and Business Systems',
      credits: 1,
      attendanceRequirement: 85,
      assignedFacultyId: 'fac-anita',
      assignedFacultyName: 'Mrs. Anita K',
      academicYear: '2026',
      estimatedRemainingClasses: 10,
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'sub-bcs515d',
      code: 'BCS515D',
      name: 'Professional Elective Course (Distributed System)',
      department: 'CSBS',
      semester: 5,
      programme: 'B.Tech in Computer Science and Business Systems',
      credits: 3,
      attendanceRequirement: 85,
      assignedFacultyId: 'fac-deshpande',
      assignedFacultyName: 'Dr. S L Deshpande',
      academicYear: '2026',
      estimatedRemainingClasses: 18,
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'sub-bcb586',
      code: 'BCB586',
      name: 'Mini Project',
      department: 'CSBS',
      semester: 5,
      programme: 'B.Tech in Computer Science and Business Systems',
      credits: 2,
      attendanceRequirement: 85,
      assignedFacultyId: 'fac-goudar',
      assignedFacultyName: 'Dr. R H Goudar',
      academicYear: '2026',
      estimatedRemainingClasses: 10,
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'sub-brmk557',
      code: 'BRMK557',
      name: 'Research Methodology and IPR',
      department: 'CSBS',
      semester: 5,
      programme: 'B.Tech in Computer Science and Business Systems',
      credits: 3,
      attendanceRequirement: 85,
      assignedFacultyId: 'fac-chinmay',
      assignedFacultyName: 'Mr. Chinmay',
      academicYear: '2026',
      estimatedRemainingClasses: 16,
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'sub-bcs508',
      code: 'BCS508',
      name: 'Environmental Studies and E-waste Management',
      department: 'CSBS',
      semester: 5,
      programme: 'B.Tech in Computer Science and Business Systems',
      credits: 1,
      attendanceRequirement: 85,
      assignedFacultyId: 'fac-archana',
      assignedFacultyName: 'Mrs. Archana H',
      academicYear: '2026',
      estimatedRemainingClasses: 12,
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'sub-bnsk559',
      code: 'BNSK559/ BPEK559/ BYOK559',
      name: 'National Service Scheme (NSS)/Physical Education (PE) (Sports and Athletics)/ Yoga',
      department: 'CSBS',
      semester: 5,
      programme: 'B.Tech in Computer Science and Business Systems',
      credits: 0,
      attendanceRequirement: 85,
      assignedFacultyId: 'fac-iranna',
      assignedFacultyName: 'Mr. Iranna T',
      academicYear: '2026',
      estimatedRemainingClasses: 10,
      status: 'Active',
      isDemo: true,
    },
  ];

  // ============================================================================
  // 4. SECTION-SPECIFIC FACULTY ASSIGNMENTS (CSBS A & CSBS B)
  // ============================================================================
  const facultyAssignments: FacultyAssignment[] = [
    // CSBS A Assignments
    {
      id: 'fa-csbsa-bcb501',
      facultyId: 'fac-harish',
      facultyName: 'Mr. Harish Kamble',
      subjectId: 'sub-bcb501',
      subjectCode: 'BCB501',
      subjectName: 'Fundamentals of Management',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsa-bcs502',
      facultyId: 'fac-rohit',
      facultyName: 'Dr. Rohit B Kaliwal',
      subjectId: 'sub-bcs502',
      subjectCode: 'BCS502',
      subjectName: 'Computer Networks',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsa-bcs503',
      facultyId: 'fac-shreeta',
      facultyName: 'Ms. Shreeta',
      subjectId: 'sub-bcs503',
      subjectCode: 'BCS503',
      subjectName: 'Theory of Computation',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsa-bcbl504',
      facultyId: 'fac-anita',
      facultyName: 'Mrs. Anita K',
      subjectId: 'sub-bcbl504',
      subjectCode: 'BCBL504',
      subjectName: 'Computational Statistics Lab',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsa-bcs515d',
      facultyId: 'fac-deshpande',
      facultyName: 'Dr. S L Deshpande',
      subjectId: 'sub-bcs515d',
      subjectCode: 'BCS515D',
      subjectName: 'Professional Elective Course (Distributed System)',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsa-bcb586',
      facultyId: 'fac-goudar',
      facultyName: 'Dr. R H Goudar',
      subjectId: 'sub-bcb586',
      subjectCode: 'BCB586',
      subjectName: 'Mini Project',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsa-brmk557',
      facultyId: 'fac-chinmay',
      facultyName: 'Mr. Chinmay',
      subjectId: 'sub-brmk557',
      subjectCode: 'BRMK557',
      subjectName: 'Research Methodology and IPR',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsa-bcs508',
      facultyId: 'fac-archana',
      facultyName: 'Mrs. Archana H',
      subjectId: 'sub-bcs508',
      subjectCode: 'BCS508',
      subjectName: 'Environmental Studies and E-waste Management',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsa-bnsk559',
      facultyId: 'fac-iranna',
      facultyName: 'Mr. Iranna T',
      subjectId: 'sub-bnsk559',
      subjectCode: 'BNSK559/ BPEK559/ BYOK559',
      subjectName: 'National Service Scheme (NSS)/Physical Education (PE) (Sports and Athletics)/ Yoga',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },

    // CSBS B Assignments (Note: BRMK557 is taught by Mr. Vinaykumar. H for CSBS B)
    {
      id: 'fa-csbsb-bcb501',
      facultyId: 'fac-harish',
      facultyName: 'Mr. Harish Kamble',
      subjectId: 'sub-bcb501',
      subjectCode: 'BCB501',
      subjectName: 'Fundamentals of Management',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsb-bcs502',
      facultyId: 'fac-rohit',
      facultyName: 'Dr. Rohit B Kaliwal',
      subjectId: 'sub-bcs502',
      subjectCode: 'BCS502',
      subjectName: 'Computer Networks',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsb-bcs503',
      facultyId: 'fac-shreeta',
      facultyName: 'Ms. Shreeta',
      subjectId: 'sub-bcs503',
      subjectCode: 'BCS503',
      subjectName: 'Theory of Computation',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsb-bcbl504',
      facultyId: 'fac-anita',
      facultyName: 'Mrs. Anita K',
      subjectId: 'sub-bcbl504',
      subjectCode: 'BCBL504',
      subjectName: 'Computational Statistics Lab',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsb-bcs515d',
      facultyId: 'fac-deshpande',
      facultyName: 'Dr. S L Deshpande',
      subjectId: 'sub-bcs515d',
      subjectCode: 'BCS515D',
      subjectName: 'Professional Elective Course (Distributed System)',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsb-bcb586',
      facultyId: 'fac-goudar',
      facultyName: 'Dr. R H Goudar',
      subjectId: 'sub-bcb586',
      subjectCode: 'BCB586',
      subjectName: 'Mini Project',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsb-brmk557',
      facultyId: 'fac-vinaykumar',
      facultyName: 'Mr. Vinaykumar. H',
      subjectId: 'sub-brmk557',
      subjectCode: 'BRMK557',
      subjectName: 'Research Methodology and IPR',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsb-bcs508',
      facultyId: 'fac-archana',
      facultyName: 'Mrs. Archana H',
      subjectId: 'sub-bcs508',
      subjectCode: 'BCS508',
      subjectName: 'Environmental Studies and E-waste Management',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
    {
      id: 'fa-csbsb-bnsk559',
      facultyId: 'fac-iranna',
      facultyName: 'Mr. Iranna T',
      subjectId: 'sub-bnsk559',
      subjectCode: 'BNSK559/ BPEK559/ BYOK559',
      subjectName: 'National Service Scheme (NSS)/Physical Education (PE) (Sports and Athletics)/ Yoga',
      sectionId: 'sec-csbs-b',
      sectionDisplayName: 'CSBS B',
      department: 'CSBS',
      semester: 5,
      academicYear: '2026',
      startDate: '2026-09-07',
      endDate: '2026-12-31',
      status: 'Active',
      isDemo: true,
    },
  ];

  // ============================================================================
  // 5. OFFICIAL WEEKLY TIMETABLE (EXACT PAGES 1 & 2 OF CSBS PDF w.e.f 07/09/2026)
  // ============================================================================
  const NEXT_DATE_BY_DAY: Record<TimetableEntry['dayOfWeek'], string> = {
    Monday: '2026-10-26',
    Tuesday: '2026-10-27',
    Wednesday: '2026-10-28',
    Thursday: '2026-10-29',
    Friday: '2026-10-30',
    Saturday: '2026-10-31',
  };

  interface RawSlot {
    id: string;
    sectionId: 'sec-csbs-a' | 'sec-csbs-b';
    faId: string;
    dayOfWeek: TimetableEntry['dayOfWeek'];
    period: string;
    startTime: string;
    endTime: string;
    classroom: string;
    batch?: 'B1' | 'B2' | 'All';
    displayOverride?: string;
  }

  const rawSlots: RawSlot[] = [
    // ---------------- CSBS A (Room VB G19) ----------------
    // Monday
    {
      id: 'tt-csbsa-mon-1',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs502',
      dayOfWeek: 'Monday',
      period: '09:00 - 10:00',
      startTime: '09:00',
      endTime: '10:00',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-mon-2',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcb501',
      dayOfWeek: 'Monday',
      period: '10:00 - 11:00',
      startTime: '10:00',
      endTime: '11:00',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-mon-3',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs502',
      dayOfWeek: 'Monday',
      period: '11:15 - 13:15 (Lab B1)',
      startTime: '11:15',
      endTime: '13:15',
      classroom: 'N2 Lab B1',
      batch: 'B1',
      displayOverride: 'BCS502 Computer Networks Lab (B1)',
    },
    {
      id: 'tt-csbsa-mon-3-b2',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcbl504',
      dayOfWeek: 'Monday',
      period: '11:15 - 13:15 (Lab B2)',
      startTime: '11:15',
      endTime: '13:15',
      classroom: 'Old Re Lab B2',
      batch: 'B2',
      displayOverride: 'BCBL504 Computational Statistics Lab (B2)',
    },
    {
      id: 'tt-csbsa-mon-4',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bnsk559',
      dayOfWeek: 'Monday',
      period: '14:15 - 16:15',
      startTime: '14:15',
      endTime: '16:15',
      classroom: 'VB G19',
      batch: 'All',
      displayOverride: 'BNSK559/ BPEK559/ BYOK559 (NSS / PE / Yoga)',
    },

    // Tuesday
    {
      id: 'tt-csbsa-tue-1',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcb501',
      dayOfWeek: 'Tuesday',
      period: '09:00 - 10:00',
      startTime: '09:00',
      endTime: '10:00',
      classroom: 'VB G19',
      batch: 'All',
    },
    {
      id: 'tt-csbsa-tue-2',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs503',
      dayOfWeek: 'Tuesday',
      period: '10:00 - 11:00',
      startTime: '10:00',
      endTime: '11:00',
      classroom: 'VB G19',
      batch: 'All',
    },
    {
      id: 'tt-csbsa-tue-3',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcbl504',
      dayOfWeek: 'Tuesday',
      period: '11:15 - 13:15 (Lab B1)',
      startTime: '11:15',
      endTime: '13:15',
      classroom: 'Old Re Lab B1',
      batch: 'B1',
      displayOverride: 'BCBL504 Computational Statistics Lab (B1)',
    },
    {
      id: 'tt-csbsa-tue-3-b2',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs502',
      dayOfWeek: 'Tuesday',
      period: '11:15 - 13:15 (Lab B2)',
      startTime: '11:15',
      endTime: '13:15',
      classroom: 'N2 Lab B2',
      batch: 'B2',
      displayOverride: 'BCS502 Computer Networks Lab (B2)',
    },
    {
      id: 'tt-csbsa-tue-4',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-brmk557',
      dayOfWeek: 'Tuesday',
      period: '14:15 - 16:15 (Tutorial)',
      startTime: '14:15',
      endTime: '16:15',
      classroom: 'VB G19',
      displayOverride: 'Research Methodology and IPR (Tutorial)',
    },

    // Wednesday
    {
      id: 'tt-csbsa-wed-1',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcb501',
      dayOfWeek: 'Wednesday',
      period: '09:00 - 10:00',
      startTime: '09:00',
      endTime: '10:00',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-wed-2',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs508',
      dayOfWeek: 'Wednesday',
      period: '10:00 - 11:00',
      startTime: '10:00',
      endTime: '11:00',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-wed-3',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs503',
      dayOfWeek: 'Wednesday',
      period: '11:15 - 12:15',
      startTime: '11:15',
      endTime: '12:15',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-wed-4',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs515d',
      dayOfWeek: 'Wednesday',
      period: '12:15 - 13:15',
      startTime: '12:15',
      endTime: '13:15',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-wed-5',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcb586',
      dayOfWeek: 'Wednesday',
      period: '14:15 - 16:15',
      startTime: '14:15',
      endTime: '16:15',
      classroom: 'VB G19',
    },

    // Thursday
    {
      id: 'tt-csbsa-thu-1',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs502',
      dayOfWeek: 'Thursday',
      period: '09:00 - 10:00',
      startTime: '09:00',
      endTime: '10:00',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-thu-2',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs503',
      dayOfWeek: 'Thursday',
      period: '10:00 - 11:00',
      startTime: '10:00',
      endTime: '11:00',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-thu-3',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-brmk557',
      dayOfWeek: 'Thursday',
      period: '11:15 - 12:15',
      startTime: '11:15',
      endTime: '12:15',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-thu-4',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs515d',
      dayOfWeek: 'Thursday',
      period: '12:15 - 13:15',
      startTime: '12:15',
      endTime: '13:15',
      classroom: 'VB G19',
    },

    // Friday
    {
      id: 'tt-csbsa-fri-1',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs515d',
      dayOfWeek: 'Friday',
      period: '09:00 - 10:00',
      startTime: '09:00',
      endTime: '10:00',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-fri-2',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-brmk557',
      dayOfWeek: 'Friday',
      period: '10:00 - 11:00',
      startTime: '10:00',
      endTime: '11:00',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-fri-3',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs502',
      dayOfWeek: 'Friday',
      period: '11:15 - 12:15',
      startTime: '11:15',
      endTime: '12:15',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-fri-4',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs508',
      dayOfWeek: 'Friday',
      period: '12:15 - 13:15',
      startTime: '12:15',
      endTime: '13:15',
      classroom: 'VB G19',
    },
    {
      id: 'tt-csbsa-fri-5',
      sectionId: 'sec-csbs-a',
      faId: 'fa-csbsa-bcs503',
      dayOfWeek: 'Friday',
      period: '14:15 - 16:15 (Tutorial)',
      startTime: '14:15',
      endTime: '16:15',
      classroom: 'VB G19',
      displayOverride: 'Theory of Computation (Tutorial)',
    },

    // ---------------- CSBS B (Room VB G17) ----------------
    // Monday
    {
      id: 'tt-csbsb-mon-1',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs508',
      dayOfWeek: 'Monday',
      period: '09:00 - 10:00',
      startTime: '09:00',
      endTime: '10:00',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-mon-2',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs515d',
      dayOfWeek: 'Monday',
      period: '10:00 - 11:00',
      startTime: '10:00',
      endTime: '11:00',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-mon-3',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcb586',
      dayOfWeek: 'Monday',
      period: '11:15 - 13:15',
      startTime: '11:15',
      endTime: '13:15',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-mon-4',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs503',
      dayOfWeek: 'Monday',
      period: '14:15 - 16:15 (Tutorial)',
      startTime: '14:15',
      endTime: '16:15',
      classroom: 'VB G17',
      displayOverride: 'Theory of Computation (Tutorial)',
    },

    // Tuesday
    {
      id: 'tt-csbsb-tue-1',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs502',
      dayOfWeek: 'Tuesday',
      period: '09:00 - 10:00',
      startTime: '09:00',
      endTime: '10:00',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-tue-2',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcb501',
      dayOfWeek: 'Tuesday',
      period: '10:00 - 11:00',
      startTime: '10:00',
      endTime: '11:00',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-tue-3',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs508',
      dayOfWeek: 'Tuesday',
      period: '11:15 - 12:15',
      startTime: '11:15',
      endTime: '12:15',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-tue-4',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs503',
      dayOfWeek: 'Tuesday',
      period: '12:15 - 13:15',
      startTime: '12:15',
      endTime: '13:15',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-tue-5',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-brmk557',
      dayOfWeek: 'Tuesday',
      period: '14:15 - 16:15 (Tutorial)',
      startTime: '14:15',
      endTime: '16:15',
      classroom: 'VB G17',
      displayOverride: 'Research Methodology and IPR (Tutorial)',
    },

    // Wednesday
    {
      id: 'tt-csbsb-wed-1',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs502',
      dayOfWeek: 'Wednesday',
      period: '09:00 - 10:00',
      startTime: '09:00',
      endTime: '10:00',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-wed-2',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs515d',
      dayOfWeek: 'Wednesday',
      period: '10:00 - 11:00',
      startTime: '10:00',
      endTime: '11:00',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-wed-3',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs502',
      dayOfWeek: 'Wednesday',
      period: '11:15 - 13:15 (Lab B1)',
      startTime: '11:15',
      endTime: '13:15',
      classroom: 'N2 Lab B1',
      batch: 'B1',
      displayOverride: 'BCS502 Computer Networks Lab (B1)',
    },
    {
      id: 'tt-csbsb-wed-3-b2',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcbl504',
      dayOfWeek: 'Wednesday',
      period: '11:15 - 13:15 (Lab B2)',
      startTime: '11:15',
      endTime: '13:15',
      classroom: 'Old Re Lab B2',
      batch: 'B2',
      displayOverride: 'BCBL504 Computational Statistics Lab (B2)',
    },
    {
      id: 'tt-csbsb-wed-4',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs503',
      dayOfWeek: 'Wednesday',
      period: '14:15 - 15:15',
      startTime: '14:15',
      endTime: '15:15',
      classroom: 'VB G17',
      batch: 'All',
    },
    {
      id: 'tt-csbsb-wed-5',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-brmk557',
      dayOfWeek: 'Wednesday',
      period: '15:15 - 16:15',
      startTime: '15:15',
      endTime: '16:15',
      classroom: 'VB G17',
      batch: 'All',
    },

    // Thursday
    {
      id: 'tt-csbsb-thu-1',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs515d',
      dayOfWeek: 'Thursday',
      period: '09:00 - 10:00',
      startTime: '09:00',
      endTime: '10:00',
      classroom: 'VB G17',
      batch: 'All',
    },
    {
      id: 'tt-csbsb-thu-2',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcb501',
      dayOfWeek: 'Thursday',
      period: '10:00 - 11:00',
      startTime: '10:00',
      endTime: '11:00',
      classroom: 'VB G17',
      batch: 'All',
    },
    {
      id: 'tt-csbsb-thu-3',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcbl504',
      dayOfWeek: 'Thursday',
      period: '11:15 - 13:15 (Lab B1)',
      startTime: '11:15',
      endTime: '13:15',
      classroom: 'Old Re Lab B1',
      batch: 'B1',
      displayOverride: 'BCBL504 Computational Statistics Lab (B1)',
    },
    {
      id: 'tt-csbsb-thu-3-b2',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs502',
      dayOfWeek: 'Thursday',
      period: '11:15 - 13:15 (Lab B2)',
      startTime: '11:15',
      endTime: '13:15',
      classroom: 'N2 Lab B2',
      batch: 'B2',
      displayOverride: 'BCS502 Computer Networks Lab (B2)',
    },
    {
      id: 'tt-csbsb-thu-4',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bnsk559',
      dayOfWeek: 'Thursday',
      period: '14:15 - 16:15',
      startTime: '14:15',
      endTime: '16:15',
      classroom: 'VB G17',
      batch: 'All',
      displayOverride: 'BNSK559/ BPEK559/ BYOK559 (NSS / PE / Yoga)',
    },

    // Friday
    {
      id: 'tt-csbsb-fri-1',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs502',
      dayOfWeek: 'Friday',
      period: '09:00 - 10:00',
      startTime: '09:00',
      endTime: '10:00',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-fri-2',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcb501',
      dayOfWeek: 'Friday',
      period: '10:00 - 11:00',
      startTime: '10:00',
      endTime: '11:00',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-fri-3',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-bcs503',
      dayOfWeek: 'Friday',
      period: '11:15 - 12:15',
      startTime: '11:15',
      endTime: '12:15',
      classroom: 'VB G17',
    },
    {
      id: 'tt-csbsb-fri-4',
      sectionId: 'sec-csbs-b',
      faId: 'fa-csbsb-brmk557',
      dayOfWeek: 'Friday',
      period: '12:15 - 13:15',
      startTime: '12:15',
      endTime: '13:15',
      classroom: 'VB G17',
    },
  ];

  const faMap = new Map<string, FacultyAssignment>(facultyAssignments.map((f) => [f.id, f]));

  const timetable: TimetableEntry[] = rawSlots.map((slot) => {
    const fa = faMap.get(slot.faId)!;
    return {
      id: slot.id,
      sectionId: slot.sectionId,
      sectionDisplayName: fa.sectionDisplayName,
      subjectId: fa.subjectId,
      subjectCode: fa.subjectCode,
      subjectName: slot.displayOverride || fa.subjectName,
      facultyAssignmentId: fa.id,
      facultyId: fa.facultyId,
      facultyName: fa.facultyName,
      dayOfWeek: slot.dayOfWeek,
      period: slot.period,
      startTime: slot.startTime,
      endTime: slot.endTime,
      classroom: slot.classroom,
      batch: slot.batch || 'All',
      validityPeriod: 'w.e.f 07/09/2026',
      upcomingDate: NEXT_DATE_BY_DAY[slot.dayOfWeek],
      upcomingStatus: 'Scheduled',
      status: 'Active',
    };
  });

  // ============================================================================
  // 6. CONDUCTED & SCHEDULED CLASS SESSIONS + STUDENT ATTENDANCE RECORDS
  // ============================================================================
  const classes: ClassSession[] = [];
  const records: AttendanceRecord[] = [];

  // Past 4 weeks since September/October 2026 for every timetable entry so every CSBS course has clean real attendance
  const PAST_WEEK_OFFSETS = [-28, -21, -14, -7];

  const csbsAStudents = users.filter((u) => u.role === 'student' && u.sectionId === 'sec-csbs-a');
  const csbsBStudents = users.filter((u) => u.role === 'student' && u.sectionId === 'sec-csbs-b');

  function shiftDate(isoDate: string, deltaDays: number): string {
    const d = new Date(`${isoDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
  }

  let recCounter = 1;
  let targetAbsentRecordForDemo = '';
  let targetApprovedRecordForDemo = '';

  for (const entry of timetable) {
    const fa = faMap.get(entry.facultyAssignmentId)!;
    const topics = SUBJECT_TOPICS[entry.subjectCode] || ['Course Lecture'];
    const durationHours = entry.endTime === '13:15' && entry.startTime === '11:15' ? 2 : entry.endTime === '16:15' && entry.startTime === '14:15' ? 2 : 1;

    PAST_WEEK_OFFSETS.forEach((offset, weekIdx) => {
      const dateStr = shiftDate(entry.upcomingDate, offset);
      const clsId = `cls-${entry.id}-w${weekIdx + 1}`;
      const topic = topics[weekIdx % topics.length];

      classes.push({
        id: clsId,
        sectionId: entry.sectionId,
        sectionDisplayName: entry.sectionDisplayName,
        subjectId: entry.subjectId,
        subjectCode: entry.subjectCode,
        subjectName: fa.subjectName,
        timetableEntryId: entry.id,
        date: dateStr,
        period: entry.period,
        startTime: entry.startTime,
        endTime: entry.endTime,
        durationHours,
        topic,
        sessionType: 'Regular',
        status: 'Conducted',
        scheduledFacultyId: entry.facultyId,
        scheduledFacultyName: entry.facultyName,
        facultyId: entry.facultyId,
        facultyName: entry.facultyName,
        isSubstitute: false,
        classroom: entry.classroom,
        batch: entry.batch || 'All',
        attendanceSubmitted: true,
        approvalStatus: 'Approved',
        isDemo: true,
      });

      let secStudents = entry.sectionId === 'sec-csbs-a' ? csbsAStudents : csbsBStudents;
      if (entry.batch === 'B1') {
        secStudents = secStudents.filter(
          (s) =>
            s.id === 'stu-csbsa-001' ||
            s.id === 'stu-csbsa-002' ||
            s.id === 'stu-csbsb-068' ||
            s.id === 'stu-csbsb-069'
        );
      } else if (entry.batch === 'B2') {
        secStudents = secStudents.filter(
          (s) => s.id === 'stu-csbsa-047' || s.id === 'stu-csbsb-116'
        );
      }
      secStudents.forEach((stu, stuIdx) => {
        const recId = `rec-${String(recCounter++).padStart(4, '0')}`;

        // Deterministic realistic attendance around 80%–92%
        let isAbsent = false;
        if (stu.id === 'stu-csbsa-001') {
          // Give Rahul a few clear absences in BCS502 and BCB501 so evidence upload can be tested immediately
          if (entry.id === 'tt-csbsa-thu-1' && (weekIdx === 2 || weekIdx === 3)) {
            isAbsent = true;
          } else if (entry.id === 'tt-csbsa-tue-1' && weekIdx === 2) {
            isAbsent = true;
          } else if (entry.id === 'tt-csbsa-fri-1' && weekIdx === 1) {
            isAbsent = true;
          }
        } else {
          isAbsent = (weekIdx + stuIdx + entry.id.length) % 8 === 0;
        }

        let status: AttendanceRecord['status'] = isAbsent ? 'Absent' : 'Present';
        let originalStatus: AttendanceRecord['status'] = status;
        let recordSource: RecordSource = 'Faculty Register';
        let correctionVersion = 1;

        // Mark one historical lab record as already verified via uploaded Lab Register PDF
        if (stu.id === 'stu-csbsa-001' && entry.id === 'tt-csbsa-tue-3' && weekIdx === 1) {
          status = 'Corrected';
          originalStatus = 'Absent';
          recordSource = 'Approved Correction';
          correctionVersion = 2;
          targetApprovedRecordForDemo = recId;
        }

        if (stu.id === 'stu-csbsa-001' && entry.id === 'tt-csbsa-thu-1' && weekIdx === 2) {
          targetAbsentRecordForDemo = recId;
        }

        records.push({
          id: recId,
          studentId: stu.id,
          classId: clsId,
          attendanceSessionId: clsId,
          sectionId: entry.sectionId,
          subjectId: entry.subjectId,
          status,
          effectivePresent: status !== 'Absent',
          originalStatus,
          recordSource,
          recordedById: entry.facultyId,
          recordedByName: entry.facultyName,
          timestamp: `${dateStr}T${entry.endTime}:00Z`,
          correctionVersion,
          pendingRequestId:
            recId === targetAbsentRecordForDemo ? 'corr-csbs-001' : undefined,
        });
      });
    });

    // Upcoming scheduled session for current week (so faculty can mark roll immediately)
    classes.push({
      id: `cls-sched-${entry.id}`,
      sectionId: entry.sectionId,
      sectionDisplayName: entry.sectionDisplayName,
      subjectId: entry.subjectId,
      subjectCode: entry.subjectCode,
      subjectName: fa.subjectName,
      timetableEntryId: entry.id,
      date: entry.upcomingDate,
      period: entry.period,
      startTime: entry.startTime,
      endTime: entry.endTime,
      durationHours,
      topic: topics[0],
      sessionType: 'Regular',
      status: 'Scheduled',
      scheduledFacultyId: entry.facultyId,
      scheduledFacultyName: entry.facultyName,
      facultyId: entry.facultyId,
      facultyName: entry.facultyName,
      isSubstitute: false,
      classroom: entry.classroom,
      attendanceSubmitted: false,
      approvalStatus: 'Approved',
      isDemo: true,
    });
  }

  // ============================================================================
  // 7. EVIDENCE-ONLY ATTENDANCE CORRECTION REQUESTS & AUDIT LOGS
  // ============================================================================
  const corrections: AttendanceCorrectionRequest[] = [];
  const auditLogs: AttendanceAuditLog[] = [];

  const demoPendingRecord = records.find((r) => r.id === targetAbsentRecordForDemo);
  const demoPendingClass = demoPendingRecord
    ? classes.find((c) => c.id === demoPendingRecord.classId)
    : undefined;

  if (demoPendingRecord && demoPendingClass) {
    corrections.push({
      id: 'corr-csbs-001',
      referenceNumber: 'VTU-CSBS-2026-101',
      studentId: 'stu-csbsa-001',
      studentName: 'Rahul Kulkarni',
      studentIdentifier: '2VX24CB001',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      attendanceRecordId: demoPendingRecord.id,
      subjectId: 'sub-bcs502',
      subjectCode: 'BCS502',
      subjectName: 'Computer Networks',
      classId: demoPendingClass.id,
      classDate: demoPendingClass.date,
      classPeriod: demoPendingClass.period,
      classTopic: demoPendingClass.topic,
      originalStatus: 'Absent',
      requestedStatus: 'Excused',
      reason: 'Medical Certificate',
      supportingNotes: '',
      evidenceFiles: [
        {
          id: 'ev-csbs-001',
          originalName: 'vtu_csbs_medical_certificate_oct14.pdf',
          storedName: 'vtu_csbs_medical_certificate_oct14.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 643,
          documentCategory: 'Medical Certificate',
          uploadedAt: '2026-10-16T10:15:00Z',
        },
      ],
      evidenceAccessLogs: [],
      workflowStatus: 'Submitted',
      appealCount: 0,
      timeline: [
        {
          status: 'Submitted',
          actorName: 'Rahul Kulkarni',
          actorRole: 'student',
          note: 'Uploaded Medical Certificate',
          timestamp: '2026-10-16T10:15:00Z',
        },
      ],
      createdAt: '2026-10-16T10:15:00Z',
      updatedAt: '2026-10-16T10:15:00Z',
    });
  }

  const demoApprovedRecord = records.find((r) => r.id === targetApprovedRecordForDemo);
  const demoApprovedClass = demoApprovedRecord
    ? classes.find((c) => c.id === demoApprovedRecord.classId)
    : undefined;

  if (demoApprovedRecord && demoApprovedClass) {
    corrections.push({
      id: 'corr-csbs-002',
      referenceNumber: 'VTU-CSBS-2026-088',
      studentId: 'stu-csbsa-001',
      studentName: 'Rahul Kulkarni',
      studentIdentifier: '2VX24CB001',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      attendanceRecordId: demoApprovedRecord.id,
      subjectId: 'sub-bcbl504',
      subjectCode: 'BCBL504',
      subjectName: 'Computational Statistics Lab',
      classId: demoApprovedClass.id,
      classDate: demoApprovedClass.date,
      classPeriod: demoApprovedClass.period,
      classTopic: demoApprovedClass.topic,
      originalStatus: 'Absent',
      requestedStatus: 'Present',
      reason: 'Signed Lab / Class Register',
      supportingNotes: '',
      evidenceFiles: [
        {
          id: 'ev-csbs-002',
          originalName: 'vtu_csbs_lab_register_oct09.pdf',
          storedName: 'vtu_csbs_lab_register_oct09.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 637,
          documentCategory: 'Signed Lab / Class Register',
          uploadedAt: '2026-10-07T09:30:00Z',
        },
      ],
      evidenceAccessLogs: [],
      workflowStatus: 'Approved',
      reviewerId: 'fac-anita',
      reviewerName: 'Mrs. Anita K',
      decisionReason: 'Verified uploaded evidence',
      appealCount: 0,
      timeline: [
        {
          status: 'Submitted',
          actorName: 'Rahul Kulkarni',
          actorRole: 'student',
          note: 'Uploaded Signed Lab / Class Register',
          timestamp: '2026-10-07T09:30:00Z',
        },
        {
          status: 'Approved',
          actorName: 'Mrs. Anita K',
          actorRole: 'faculty',
          note: 'Verified uploaded evidence',
          timestamp: '2026-10-07T14:10:00Z',
        },
      ],
      createdAt: '2026-10-07T09:30:00Z',
      updatedAt: '2026-10-07T14:10:00Z',
    });

    auditLogs.push({
      id: 'aud-csbs-001',
      category: 'CORRECTION_WORKFLOW',
      attendanceRecordId: demoApprovedRecord.id,
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      subjectId: 'sub-bcbl504',
      subjectCode: 'BCBL504',
      subjectName: 'Computational Statistics Lab',
      classId: demoApprovedClass.id,
      classDate: demoApprovedClass.date,
      classPeriod: demoApprovedClass.period,
      studentId: 'stu-csbsa-001',
      studentName: 'Rahul Kulkarni',
      studentIdentifier: '2VX24CB001',
      previousValue: 'Absent',
      newValue: 'Corrected (Present)',
      previousVersion: 1,
      newVersion: 2,
      action: 'CORRECTION_APPROVED',
      actorId: 'fac-anita',
      actorName: 'Mrs. Anita K',
      actorRole: 'faculty',
      correctionRequestId: 'corr-csbs-002',
      correctionReferenceNumber: 'VTU-CSBS-2026-088',
      reason: 'Signed Lab / Class Register',
      evidenceReference: 'vtu_csbs_lab_register_oct09.pdf (ev-csbs-002)',
      timestamp: '2026-10-07T14:10:00Z',
    });
  }

  const notifications: AppNotification[] = [
    {
      id: 'notif-csbs-001',
      recipientId: 'fac-rohit',
      type: 'CORRECTION_SUBMITTED',
      title: 'Evidence uploaded: BCS502 (CSBS A)',
      message: 'Rahul Kulkarni (2VX24CB001) uploaded Medical Certificate for BCS502.',
      relatedRecordId: 'corr-csbs-001',
      targetNav: 'corrections',
      read: false,
      timestamp: '2026-10-16T10:15:00Z',
    },
    {
      id: 'notif-csbs-002',
      recipientId: 'stu-csbsa-001',
      type: 'CORRECTION_UPDATE',
      title: 'Evidence approved: BCBL504',
      message: 'Mrs. Anita K verified your uploaded document and updated BCBL504 attendance.',
      relatedRecordId: 'corr-csbs-002',
      targetNav: 'corrections',
      read: false,
      timestamp: '2026-10-07T14:10:00Z',
    },
  ];

  const deviceBindings: StudentDeviceBinding[] = users
    .filter((u) => u.role === 'student')
    .map((u, idx) => ({
      id: `dev-bind-${u.id}`,
      studentId: u.id,
      studentName: u.name,
      studentIdentifier: u.identifier,
      sectionDisplayName: u.sectionDisplayName || 'CSBS A',
      deviceFingerprint: `VTU-DEVICE-${u.identifier.replace(/[^a-zA-Z0-9]/g, '')}`,
      devicePlatform: idx % 2 === 0 ? 'Android Mobile' : 'iOS Mobile',
      browserName: 'Mobile Chrome / Safari',
      status: 'Approved',
      registeredAt: '2026-09-01T08:00:00Z',
      lastUsedAt: '2026-10-18T09:00:00Z',
      history: [
        {
          id: `dev-hist-${u.id}-init`,
          deviceFingerprint: `VTU-DEVICE-${u.identifier.replace(/[^a-zA-Z0-9]/g, '')}`,
          devicePlatform: idx % 2 === 0 ? 'Android Mobile' : 'iOS Mobile',
          browserName: 'Mobile Chrome / Safari',
          action: 'FIRST_REGISTRATION',
          actorId: u.id,
          actorRole: 'student',
          timestamp: '2026-09-01T08:00:00Z',
          reason: 'Initial institutional primary device enrollment.',
        },
      ],
    }));

  const qrSessions: QRAttendanceSession[] = [
    {
      id: 'qr-sess-demo-001',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      subjectId: 'sub-bcs502',
      subjectCode: 'BCS502',
      subjectName: 'Computer Networks',
      facultyId: 'fac-rohit',
      facultyName: 'Dr. Rohit B Kaliwal',
      classroom: 'VB G19',
      hostLatitude: 15.8858,
      hostLongitude: 74.5298,
      hostAccuracy: 8,
      date: '2026-10-16',
      startTime: '09:00',
      endTime: '10:00',
      currentQrToken: 'VTU-QR-TOKEN-DEMO-BCS502-OCT16',
      tokenExpiresAt: Date.now() - 3600000,
      tokenIssuedAt: Date.now() - 3900000,
      sessionExpiresAt: Date.now() - 3300000,
      durationMinutes: 5,
      status: 'CLOSED',
      refreshCount: 10,
      totalEnrolled: 62,
      verifiedCount: 56,
      reviewRequiredCount: 2,
      rejectedCount: 1,
      createdAt: '2026-10-16T09:02:00Z',
      closedAt: '2026-10-16T09:07:00Z',
    },
  ];

  const attendanceAttempts: AttendanceSubmissionAttempt[] = [
    {
      id: 'att-attempt-001',
      sessionId: 'qr-sess-demo-001',
      studentId: 'stu-csbsa-001',
      studentName: 'Rahul Kulkarni',
      studentIdentifier: '2VX24CB001',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      subjectId: 'sub-bcs502',
      subjectCode: 'BCS502',
      subjectName: 'Computer Networks',
      facultyId: 'fac-rohit',
      submittedAt: '2026-10-16T09:03:15Z',
      serverTimestamp: Date.now() - 3700000,
      qrTokenReference: 'VTU-QR-TOKEN-DEMO-BCS502-OCT16',
      reportedLatitude: 15.88582,
      reportedLongitude: 74.52985,
      reportedAccuracy: 12,
      calculatedDistanceMeters: 5.8,
      isWithinRadius: true,
      isAccuracyAcceptable: true,
      deviceFingerprint: 'VTU-DEVICE-2VX24CB001',
      devicePlatform: 'Android Mobile',
      deviceStatus: 'Registered',
      classification: 'VERIFIED',
      suspiciousSignals: [],
      attendanceRecordCreated: true,
    },
    {
      id: 'att-attempt-002',
      sessionId: 'qr-sess-demo-001',
      studentId: 'stu-csbsa-002',
      studentName: 'Priya Hegde',
      studentIdentifier: '2VX24CB002',
      sectionId: 'sec-csbs-a',
      sectionDisplayName: 'CSBS A',
      subjectId: 'sub-bcs502',
      subjectCode: 'BCS502',
      subjectName: 'Computer Networks',
      facultyId: 'fac-rohit',
      submittedAt: '2026-10-16T09:04:10Z',
      serverTimestamp: Date.now() - 3650000,
      qrTokenReference: 'VTU-QR-TOKEN-DEMO-BCS502-OCT16',
      reportedLatitude: 15.8899,
      reportedLongitude: 74.532,
      reportedAccuracy: 45,
      calculatedDistanceMeters: 480,
      isWithinRadius: false,
      isAccuracyAcceptable: true,
      deviceFingerprint: 'VTU-DEVICE-2VX24CB002',
      devicePlatform: 'iOS Mobile',
      deviceStatus: 'Registered',
      classification: 'REJECTED',
      rejectionOrReviewReason: 'Outside permitted campus perimeter (480m > 350m allowed radius)',
      suspiciousSignals: ['GEO_OUT_OF_BOUNDS: Distance 480m exceeds campus limit 350m'],
      attendanceRecordCreated: false,
    },
  ];

  const randomVerifications: RandomInClassVerification[] = [];

  return {
    schemaVersion: CURRENT_SEED_SCHEMA_VERSION,
    policy,
    sections,
    users,
    subjects,
    facultyAssignments,
    classes,
    records,
    corrections,
    auditLogs,
    timetable,
    notifications,
    qrSessions,
    deviceBindings,
    attendanceAttempts,
    randomVerifications,
  };
}
