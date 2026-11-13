import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  Clock,
  Download,
  Info,
  MapPin,
  Printer,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { VtuEmblemLogo } from './VtuEmblemLogo.tsx';
import {
  ClassSession,
  TimetableEntry,
  UserProfile,
} from '../shared/types.ts';

export interface OfficialVTUTimetableDocumentProps {
  sectionId: string;
  activeUser: UserProfile;
  timetable: TimetableEntry[];
  classes: ClassSession[];
  onSelectSession?: (sessionId: string) => void;
}

interface CourseFacultyInfo {
  code: string;
  title: string;
  facultyName: string;
  designation?: string;
  credits?: number;
  type?: 'Core' | 'Elective' | 'Lab' | 'Project' | 'Mandatory';
}

interface MatrixCell {
  code: string;
  subText?: string;
  labBatches?: Array<{
    code: string;
    labName: string;
    batch: 'B1' | 'B2';
    facultyName: string;
  }>;
  colspan?: number;
  isBreak?: boolean;
  isEmpty?: boolean;
  isTutorial?: boolean;
  isProject?: boolean;
}

const COURSES_CSBS_A: CourseFacultyInfo[] = [
  {
    code: 'BCB501',
    title: 'Fundamentals of Management',
    facultyName: 'Mr. Harish Kamble',
    credits: 3,
    type: 'Core',
  },
  {
    code: 'BCS502',
    title: 'Computer Networks',
    facultyName: 'Dr. Rohit B Kaliwal',
    credits: 4,
    type: 'Core',
  },
  {
    code: 'BCS503',
    title: 'Theory of Computation',
    facultyName: 'Ms. Shreeta',
    credits: 4,
    type: 'Core',
  },
  {
    code: 'BCBL504',
    title: 'Computational Statistics Lab',
    facultyName: 'Mrs. Anita K',
    credits: 1,
    type: 'Lab',
  },
  {
    code: 'BCS515D',
    title: 'Professional Elective Course (Distributed System)',
    facultyName: 'Dr. S L Deshpande',
    credits: 3,
    type: 'Elective',
  },
  {
    code: 'BCB586',
    title: 'Mini Project',
    facultyName: 'Dr. R H Goudar',
    credits: 2,
    type: 'Project',
  },
  {
    code: 'BRMK557',
    title: 'Research Methodology and IPR',
    facultyName: 'Mr. Chinmay',
    credits: 3,
    type: 'Core',
  },
  {
    code: 'BCS508',
    title: 'Environmental Studies and E-waste Management',
    facultyName: 'Mrs. Archana H',
    credits: 1,
    type: 'Mandatory',
  },
  {
    code: 'BNSK559/ BPEK559/ BYOK559',
    title:
      'National Service Scheme (NSS)/Physical Education (PE) (Sports and Athletics)/ Yoga',
    facultyName: 'Mr. Iranna T',
    credits: 0,
    type: 'Mandatory',
  },
];

const COURSES_CSBS_B: CourseFacultyInfo[] = [
  {
    code: 'BCB501',
    title: 'Fundamentals of Management',
    facultyName: 'Mr. Harish Kamble',
    credits: 3,
    type: 'Core',
  },
  {
    code: 'BCS502',
    title: 'Computer Networks',
    facultyName: 'Dr. Rohit B Kaliwal',
    credits: 4,
    type: 'Core',
  },
  {
    code: 'BCS503',
    title: 'Theory of Computation',
    facultyName: 'Ms. Shreeta',
    credits: 4,
    type: 'Core',
  },
  {
    code: 'BCBL504',
    title: 'Computational Statistics Lab',
    facultyName: 'Mrs. Anita K',
    credits: 1,
    type: 'Lab',
  },
  {
    code: 'BCS515D',
    title: 'Professional Elective Course (Distributed System)',
    facultyName: 'Dr. S L Deshpande',
    credits: 3,
    type: 'Elective',
  },
  {
    code: 'BCB586',
    title: 'Mini Project',
    facultyName: 'Dr. R H Goudar',
    credits: 2,
    type: 'Project',
  },
  {
    code: 'BRMK557',
    title: 'Research Methodology and IPR',
    facultyName: 'Mr. Vinaykumar. H',
    credits: 3,
    type: 'Core',
  },
  {
    code: 'BCS508',
    title: 'Environmental Studies and E-waste Management',
    facultyName: 'Mrs. Archana H',
    credits: 1,
    type: 'Mandatory',
  },
  {
    code: 'BNSK559/ BPEK559/ BYOK559',
    title:
      'National Service Scheme (NSS)/ Physical Education (PE) (Sports and Athletics)/ Yoga',
    facultyName: 'Mr. Iranna T',
    credits: 0,
    type: 'Mandatory',
  },
];

export function getStudentBatch(user: UserProfile): 'B1' | 'B2' | null {
  if (user.role !== 'student') return null;
  const idStr = (user.identifier || '').toUpperCase();
  const match = idStr.match(/2VX24CB(\d+)/);
  if (!match) return 'B1';
  const num = parseInt(match[1], 10);
  if (user.sectionId === 'sec-csbs-b' || user.section === 'B') {
    return num <= 115 ? 'B1' : 'B2';
  }
  return num <= 46 ? 'B1' : 'B2';
}

export const OfficialVTUTimetableDocument: React.FC<OfficialVTUTimetableDocumentProps> = ({
  sectionId,
  activeUser,
  timetable,
  classes,
  onSelectSession,
}) => {
  const isSectionA = sectionId === 'sec-csbs-a';
  const divisionName = isSectionA ? 'A Division' : 'B Division';
  const classroomNo = isSectionA ? 'VB G19' : 'VB G17';
  const coursesList = isSectionA ? COURSES_CSBS_A : COURSES_CSBS_B;

  const [selectedCourseModal, setSelectedCourseModal] = useState<CourseFacultyInfo | null>(
    null
  );
  const [highlightBatch, setHighlightBatch] = useState<'All' | 'B1' | 'B2'>('All');

  const studentBatch = useMemo(() => getStudentBatch(activeUser), [activeUser]);

  // Check if a course code matches the logged-in faculty
  const isFacultyCourse = (code: string) => {
    if (activeUser.role !== 'faculty') return false;
    const course = coursesList.find((c) => c.code === code || code.startsWith(c.code));
    if (!course) return false;
    const cleanUser = activeUser.name.toLowerCase().replace(/^(dr\.|mr\.|mrs\.|ms\.)\s*/, '').trim();
    const cleanFac = course.facultyName.toLowerCase().replace(/^(dr\.|mr\.|mrs\.|ms\.)\s*/, '').trim();
    return cleanFac.includes(cleanUser) || cleanUser.includes(cleanFac);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* ACTION TOOLBAR - HIDDEN DURING PRINT */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 bg-[#FFFDF8] p-3.5 rounded-lg border border-[#E3D2B4]">
        <div className="flex items-center gap-2 text-xs text-[#6B5A4C]">
          <span className="font-semibold text-[#165B33]">Official View:</span>
          <span>w.e.f 07/09/2026 · Room {classroomNo} · Semester V</span>
          {studentBatch && activeUser.sectionId === sectionId && (
            <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#DF6A24]/10 text-[#DF6A24] border border-[#DF6A24]/30">
              <Sparkles className="w-3 h-3" />
              Your Batch: {studentBatch}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Highlight Batch toggle for students */}
          <div className="inline-flex rounded-md border border-[#E3D2B4] bg-white p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setHighlightBatch('All')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                highlightBatch === 'All'
                  ? 'bg-[#165B33] text-white shadow-xs'
                  : 'text-[#6B5A4C] hover:text-[#241710]'
              }`}
            >
              All Batches
            </button>
            <button
              type="button"
              onClick={() => setHighlightBatch('B1')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                highlightBatch === 'B1'
                  ? 'bg-[#DF6A24] text-white shadow-xs'
                  : 'text-[#6B5A4C] hover:text-[#241710]'
              }`}
            >
              Batch B1 {studentBatch === 'B1' ? '★' : ''}
            </button>
            <button
              type="button"
              onClick={() => setHighlightBatch('B2')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                highlightBatch === 'B2'
                  ? 'bg-[#DF6A24] text-white shadow-xs'
                  : 'text-[#6B5A4C] hover:text-[#241710]'
              }`}
            >
              Batch B2 {studentBatch === 'B2' ? '★' : ''}
            </button>
          </div>

          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#165B33] bg-[#165B33] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#104526] transition-colors shadow-xs"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Official Copy
          </button>

          <a
            href="/assets/aistudio/5_Sem_2026_TimeTable_CSBS_a274fa8c.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E3D2B4] bg-white px-3 py-1.5 text-xs font-semibold text-[#165B33] hover:bg-[#FFFDF8] transition-colors shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            Download Original PDF
          </a>
        </div>
      </div>

      {/* PRINT-CONTAINER: OFFICIAL DOCUMENT CANVAS */}
      <div className="print-container bg-white rounded-lg border border-[#241710]/20 p-5 sm:p-8 shadow-xs text-[#241710] font-sans">
        {/* DOCUMENT HEADER */}
        <div className="text-center pb-4 border-b border-[#241710]/20">
          <div className="flex items-center justify-center gap-4 mb-2">
            <VtuEmblemLogo size="sm" className="hidden sm:inline-flex border-0 bg-transparent p-0 w-14 h-16" />
            <div>
              <div className="text-base sm:text-lg font-bold tracking-wide text-[#165B33] font-serif">
                ವಿಶ್ವೇಶ್ವರಯ್ಯ ತಾಂತ್ರಿಕ ವಿಶ್ವವಿದ್ಯಾಲಯ, ಬೆಳಗಾವಿ
              </div>
              <div className="text-sm sm:text-base font-extrabold tracking-wider uppercase text-[#165B33]">
                VISVESVARAYA TECHNOLOGICAL UNIVERSITY - BELAGAVI
              </div>
            </div>
            <VtuEmblemLogo size="sm" className="hidden sm:inline-flex border-0 bg-transparent p-0 w-14 h-16" />
          </div>

          <div className="text-xs sm:text-[13px] font-semibold text-[#241710]">
            Department of Computer Science and Engineering, “Jnana Sangama”, VTU-Campus, Belagavi-590018, Karnataka, India
          </div>
          <div className="text-xs sm:text-sm font-bold text-[#165B33] mt-0.5">
            B. Tech in Computer Science and Business Systems (CSBS) {divisionName}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs font-semibold text-[#241710] mt-2 pt-2 border-t border-dashed border-[#241710]/20">
            <span>Time Table: 2026</span>
            <span>Class Room No: <strong className="text-[#165B33]">{classroomNo}</strong></span>
            <span>V SEMESTER</span>
            <span>w.e.f: <strong>07/09/2026</strong></span>
          </div>

          {/* BATCH ALLOCATION NOTICE */}
          <div className="mt-2 text-[11px] sm:text-xs font-medium text-[#241710]/90 bg-[#FFFDF8] py-1.5 px-3 rounded border border-[#E3D2B4]/60">
            {isSectionA ? (
              <>
                <span className="font-bold">Note:</span> Batch B1 from USN: <strong>2VX24CB001</strong> to USN: <strong>2VX24CB046</strong> and Batch B2 from USN: <strong>2VX24CB047</strong> to USN: <strong>2VX24CB067</strong> + Lateral entry
                <div className="text-[10px] text-[#6B5A4C]">(The batches are framed According to Previous 4th Semester Division)</div>
              </>
            ) : (
              <>
                <span className="font-bold">Note:</span> Batch B1 from USN: <strong>2VX24CB068</strong> to USN: <strong>2VX24CB115</strong> and Batch B2 from USN: <strong>2VX24CB116</strong> to till last USN + Lateral entry
                <div className="text-[10px] text-[#6B5A4C]">(The batches are framed According to Previous 4th Semester Division)</div>
              </>
            )}
          </div>
        </div>

        {/* OFFICIAL MATRIX TABLE */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse border border-[#241710] text-center text-xs">
            <thead>
              <tr className="bg-[#FAF3E3] font-bold text-[#241710] border-b border-[#241710]">
                <th className="border border-[#241710] py-2.5 px-2 w-[72px] text-center align-middle font-bold text-[11px]">
                  Time<br />Days
                </th>
                <th className="border border-[#241710] py-2 px-1 text-[11px] leading-tight min-w-[85px]">
                  09:00 AM<br />TO<br />10:00 AM
                </th>
                <th className="border border-[#241710] py-2 px-1 text-[11px] leading-tight min-w-[85px]">
                  10:00 AM<br />TO<br />11:00 AM
                </th>
                <th className="border border-[#241710] py-2 px-1 text-[10px] leading-tight w-[38px] bg-[#FFF9EC]">
                  11:00 AM<br />TO<br />11:15 AM
                </th>
                <th className="border border-[#241710] py-2 px-1 text-[11px] leading-tight min-w-[85px]">
                  11:15 AM<br />TO<br />12:15 PM
                </th>
                <th className="border border-[#241710] py-2 px-1 text-[11px] leading-tight min-w-[85px]">
                  12:15 PM<br />TO<br />01:15 PM
                </th>
                <th className="border border-[#241710] py-2 px-1 text-[10px] leading-tight w-[38px] bg-[#FFF9EC]">
                  01:15 PM<br />TO<br />02:15 PM
                </th>
                <th className="border border-[#241710] py-2 px-1 text-[11px] leading-tight min-w-[85px]">
                  2:15 PM<br />TO<br />3:15 PM
                </th>
                <th className="border border-[#241710] py-2 px-1 text-[11px] leading-tight min-w-[85px]">
                  3:15 PM<br />TO<br />4:15 PM
                </th>
                <th className="border border-[#241710] py-2 px-1 text-[11px] leading-tight min-w-[75px]">
                  4:15 PM<br />TO<br />5:15 PM
                </th>
              </tr>
            </thead>
            <tbody>
              {isSectionA ? (
                // ============================================
                // CSBS A DIVISION MATRIX (PAGE 1)
                // ============================================
                <>
                  {/* MON */}
                  <tr className="border-b border-[#241710] h-14">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      MON
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[1])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS502') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS502
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[0])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCB501') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCB501
                    </td>
                    {/* TEA BREAK - Spans rows MON-SAT */}
                    <td
                      rowSpan={6}
                      className="border border-[#241710] bg-[#FFF9EC] text-center font-bold tracking-[0.25em] text-[#DF6A24] text-[11px] select-none uppercase"
                      style={{ writingMode: 'vertical-rl', textOrientation: 'upright' }}
                    >
                      TEA BREAK
                    </td>
                    {/* 11:15 - 01:15 LAB MERGED */}
                    <td colSpan={2} className="border border-[#241710] p-1.5 text-[11px] leading-tight">
                      <div
                        onClick={() => setSelectedCourseModal(COURSES_CSBS_A[1])}
                        className={`cursor-pointer rounded px-1 py-0.5 font-bold ${
                          highlightBatch === 'B1' || studentBatch === 'B1'
                            ? 'bg-[#165B33]/10 text-[#165B33] font-extrabold'
                            : ''
                        }`}
                      >
                        BCS502 N2 Lab B1
                      </div>
                      <div
                        onClick={() => setSelectedCourseModal(COURSES_CSBS_A[3])}
                        className={`cursor-pointer rounded px-1 py-0.5 font-bold ${
                          highlightBatch === 'B2' || studentBatch === 'B2'
                            ? 'bg-[#DF6A24]/10 text-[#DF6A24] font-extrabold'
                            : ''
                        }`}
                      >
                        BCBL504 Old Re Lab B2
                      </div>
                    </td>
                    {/* LUNCH BREAK - Spans rows MON-SAT */}
                    <td
                      rowSpan={6}
                      className="border border-[#241710] bg-[#FFF9EC] text-center font-bold tracking-[0.25em] text-[#165B33] text-[11px] select-none uppercase"
                      style={{ writingMode: 'vertical-rl', textOrientation: 'upright' }}
                    >
                      LUNCH BREAK
                    </td>
                    {/* 2:15 - 4:15 NSS/PE/Yoga MERGED */}
                    <td
                      colSpan={2}
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[8])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-[11px] p-1 ${
                        isFacultyCourse('BNSK559') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BNSK559/ BPEK559/<br />BYOK559
                    </td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                  </tr>

                  {/* TUE */}
                  <tr className="border-b border-[#241710] h-14">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      TUE
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[0])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCB501') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCB501
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[2])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS503') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS503
                    </td>
                    {/* 11:15 - 01:15 LAB MERGED */}
                    <td colSpan={2} className="border border-[#241710] p-1.5 text-[11px] leading-tight">
                      <div
                        onClick={() => setSelectedCourseModal(COURSES_CSBS_A[1])}
                        className={`cursor-pointer rounded px-1 py-0.5 font-bold ${
                          highlightBatch === 'B2' || studentBatch === 'B2'
                            ? 'bg-[#165B33]/10 text-[#165B33] font-extrabold'
                            : ''
                        }`}
                      >
                        BCS502 N2 Lab B2
                      </div>
                      <div
                        onClick={() => setSelectedCourseModal(COURSES_CSBS_A[3])}
                        className={`cursor-pointer rounded px-1 py-0.5 font-bold ${
                          highlightBatch === 'B1' || studentBatch === 'B1'
                            ? 'bg-[#DF6A24]/10 text-[#DF6A24] font-extrabold'
                            : ''
                        }`}
                      >
                        BCBL504 Old Re Lab B1
                      </div>
                    </td>
                    {/* 2:15 - 4:15 BRMK557 (Tutorial) */}
                    <td
                      colSpan={2}
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[6])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs p-1 ${
                        isFacultyCourse('BRMK557') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BRMK557 (Tutorial)
                    </td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                  </tr>

                  {/* WED */}
                  <tr className="border-b border-[#241710] h-14">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      WED
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[0])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCB501') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCB501
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[7])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS508') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS508
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[2])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS503') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS503
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[4])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS515D') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS515D
                    </td>
                    {/* 2:15 - 4:15 BCB586 Mini Project */}
                    <td
                      colSpan={2}
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[5])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs p-1 ${
                        isFacultyCourse('BCB586') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCB586
                    </td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                  </tr>

                  {/* THUR */}
                  <tr className="border-b border-[#241710] h-14">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      THUR
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[1])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS502') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS502
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[2])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS503') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS503
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[6])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BRMK557') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BRMK557
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[4])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS515D') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS515D
                    </td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                  </tr>

                  {/* FRI */}
                  <tr className="border-b border-[#241710] h-14">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      FRI
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[4])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS515D') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS515D
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[6])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BRMK557') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BRMK557
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[1])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS502') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS502
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[7])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS508') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS508
                    </td>
                    {/* 2:15 - 4:15 BCS503 (Tutorial) */}
                    <td
                      colSpan={2}
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_A[2])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs p-1 ${
                        isFacultyCourse('BCS503') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS503 (Tutorial)
                    </td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                  </tr>

                  {/* SAT */}
                  <tr className="border-b border-[#241710] h-9 bg-[#FAFAFA]">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      SAT
                    </td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                  </tr>
                </>
              ) : (
                // ============================================
                // CSBS B DIVISION MATRIX (PAGE 2)
                // ============================================
                <>
                  {/* MON */}
                  <tr className="border-b border-[#241710] h-14">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      MON
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[7])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS508') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS508
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[4])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS515D') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS515D
                    </td>
                    {/* TEA BREAK - Spans rows MON-SAT */}
                    <td
                      rowSpan={6}
                      className="border border-[#241710] bg-[#FFF9EC] text-center font-bold tracking-[0.25em] text-[#DF6A24] text-[11px] select-none uppercase"
                      style={{ writingMode: 'vertical-rl', textOrientation: 'upright' }}
                    >
                      TEA BREAK
                    </td>
                    {/* 11:15 - 01:15 BCB586 MERGED */}
                    <td
                      colSpan={2}
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[5])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs p-1 ${
                        isFacultyCourse('BCB586') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCB586
                    </td>
                    {/* LUNCH BREAK - Spans rows MON-SAT */}
                    <td
                      rowSpan={6}
                      className="border border-[#241710] bg-[#FFF9EC] text-center font-bold tracking-[0.25em] text-[#165B33] text-[11px] select-none uppercase"
                      style={{ writingMode: 'vertical-rl', textOrientation: 'upright' }}
                    >
                      LUNCH BREAK
                    </td>
                    {/* 2:15 - 4:15 BCS503 (Tutorial) */}
                    <td
                      colSpan={2}
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[2])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs p-1 ${
                        isFacultyCourse('BCS503') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS503 (Tutorial)
                    </td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                  </tr>

                  {/* TUE */}
                  <tr className="border-b border-[#241710] h-14">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      TUE
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[1])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS502') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS502
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[0])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCB501') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCB501
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[7])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS508') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS508
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[2])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS503') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS503
                    </td>
                    {/* 2:15 - 4:15 BRMK557 (Tutorial) */}
                    <td
                      colSpan={2}
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[6])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs p-1 ${
                        isFacultyCourse('BRMK557') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BRMK557 (Tutorial)
                    </td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                  </tr>

                  {/* WED */}
                  <tr className="border-b border-[#241710] h-14">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      WED
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[1])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS502') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS502
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[4])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS515D') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS515D
                    </td>
                    {/* 11:15 - 01:15 LAB MERGED */}
                    <td colSpan={2} className="border border-[#241710] p-1.5 text-[11px] leading-tight">
                      <div
                        onClick={() => setSelectedCourseModal(COURSES_CSBS_B[1])}
                        className={`cursor-pointer rounded px-1 py-0.5 font-bold ${
                          highlightBatch === 'B1' || studentBatch === 'B1'
                            ? 'bg-[#165B33]/10 text-[#165B33] font-extrabold'
                            : ''
                        }`}
                      >
                        BCS502 N2 Lab B1
                      </div>
                      <div
                        onClick={() => setSelectedCourseModal(COURSES_CSBS_B[3])}
                        className={`cursor-pointer rounded px-1 py-0.5 font-bold ${
                          highlightBatch === 'B2' || studentBatch === 'B2'
                            ? 'bg-[#DF6A24]/10 text-[#DF6A24] font-extrabold'
                            : ''
                        }`}
                      >
                        BCBL504 Old Re Lab B2
                      </div>
                    </td>
                    {/* 2:15 - 3:15 BCS503 */}
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[2])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS503') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS503
                    </td>
                    {/* 3:15 - 4:15 BRMK557 */}
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[6])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BRMK557') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BRMK557
                    </td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                  </tr>

                  {/* THUR */}
                  <tr className="border-b border-[#241710] h-14">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      THUR
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[4])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS515D') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS515D
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[0])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCB501') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCB501
                    </td>
                    {/* 11:15 - 01:15 LAB MERGED */}
                    <td colSpan={2} className="border border-[#241710] p-1.5 text-[11px] leading-tight">
                      <div
                        onClick={() => setSelectedCourseModal(COURSES_CSBS_B[1])}
                        className={`cursor-pointer rounded px-1 py-0.5 font-bold ${
                          highlightBatch === 'B2' || studentBatch === 'B2'
                            ? 'bg-[#165B33]/10 text-[#165B33] font-extrabold'
                            : ''
                        }`}
                      >
                        BCS502 N2 Lab B2
                      </div>
                      <div
                        onClick={() => setSelectedCourseModal(COURSES_CSBS_B[3])}
                        className={`cursor-pointer rounded px-1 py-0.5 font-bold ${
                          highlightBatch === 'B1' || studentBatch === 'B1'
                            ? 'bg-[#DF6A24]/10 text-[#DF6A24] font-extrabold'
                            : ''
                        }`}
                      >
                        BCBL504 Old Re Lab B1
                      </div>
                    </td>
                    {/* 2:15 - 4:15 NSS/PE/Yoga MERGED */}
                    <td
                      colSpan={2}
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[8])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-[11px] p-1 ${
                        isFacultyCourse('BNSK559') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BNSK559/ BPEK559/<br />BYOK559
                    </td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                  </tr>

                  {/* FRI */}
                  <tr className="border-b border-[#241710] h-14">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      FRI
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[1])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS502') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS502
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[0])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCB501') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCB501
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[2])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BCS503') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BCS503
                    </td>
                    <td
                      onClick={() => setSelectedCourseModal(COURSES_CSBS_B[6])}
                      className={`border border-[#241710] cursor-pointer hover:bg-[#FFFDF8] font-bold text-xs ${
                        isFacultyCourse('BRMK557') ? 'bg-[#DF6A24]/15 ring-2 ring-[#DF6A24]' : ''
                      }`}
                    >
                      BRMK557
                    </td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                    <td className="border border-[#241710] text-[#6B5A4C] select-none">----------</td>
                  </tr>

                  {/* SAT */}
                  <tr className="border-b border-[#241710] h-9 bg-[#FAFAFA]">
                    <td className="border border-[#241710] font-bold text-center bg-[#FAF3E3] text-[11px]">
                      SAT
                    </td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                    <td className="border border-[#241710]"></td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* BOTTOM OFFICIAL FACULTY MAPPING TABLE */}
        <div className="mt-6 pt-4 border-t border-[#241710]/20">
          <div className="text-xs font-bold uppercase tracking-wider text-[#165B33] mb-2 text-center">
            Course Structure & Designated Faculty
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-[#241710] text-xs">
              <thead>
                <tr className="bg-[#FAF3E3] border-b border-[#241710] font-bold text-[#241710]">
                  <th className="border border-[#241710] py-1.5 px-3 text-left w-36">Course Code</th>
                  <th className="border border-[#241710] py-1.5 px-3 text-left">Course Title</th>
                  <th className="border border-[#241710] py-1.5 px-3 text-left w-60">Faculty Names</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#241710]">
                {coursesList.map((course) => {
                  const isMine = isFacultyCourse(course.code);
                  return (
                    <tr
                      key={course.code}
                      onClick={() => setSelectedCourseModal(course)}
                      className={`cursor-pointer transition-colors ${
                        isMine
                          ? 'bg-[#DF6A24]/10 font-semibold'
                          : 'hover:bg-[#FFFDF8]'
                      }`}
                    >
                      <td className="border border-[#241710] py-1.5 px-3 font-mono font-bold text-[#DF6A24]">
                        {course.code}
                      </td>
                      <td className="border border-[#241710] py-1.5 px-3 font-medium text-[#241710]">
                        {course.title}
                      </td>
                      <td className="border border-[#241710] py-1.5 px-3 font-semibold text-[#165B33]">
                        {course.facultyName}
                        {isMine && (
                          <span className="ml-2 text-[10px] text-[#DF6A24] font-bold uppercase tracking-wide">
                            (You)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* INSTITUTIONAL SIGN-OFF FOOTER */}
        <div className="mt-8 pt-4 border-t border-dashed border-[#241710]/20 flex flex-wrap items-end justify-between gap-6 text-[11px] text-[#6B5A4C]">
          <div>
            <div>Belagavi, Karnataka</div>
            <div>Department of CSE, VTU Jnana Sangama</div>
          </div>
          <div className="text-center">
            <div className="font-semibold text-[#241710]">Timetable Committee Coordinator</div>
            <div>Department of CSE, VTU Belagavi</div>
          </div>
          <div className="text-right">
            <div className="font-semibold text-[#241710]">Dean / Head of Department</div>
            <div>Visvesvaraya Technological University</div>
          </div>
        </div>
      </div>

      {/* COURSE DETAIL MODAL */}
      {selectedCourseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-md rounded-lg border border-[#E3D2B4] bg-white p-5 shadow-xl space-y-4">
            <button
              type="button"
              onClick={() => setSelectedCourseModal(null)}
              className="absolute top-3.5 right-3.5 rounded p-1 text-[#6B5A4C] hover:text-[#241710] hover:bg-[#FFFDF8]"
            >
              <X className="w-4 h-4" />
            </button>

            <div>
              <span className="inline-block px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#DF6A24]/10 text-[#DF6A24] border border-[#DF6A24]/30">
                {selectedCourseModal.code}
              </span>
              <h3 className="mt-1 text-base font-bold text-[#165B33]">
                {selectedCourseModal.title}
              </h3>
              <p className="text-xs text-[#6B5A4C]">
                V-Semester CSBS {divisionName} · Department of Computer Science & Engineering
              </p>
            </div>

            <div className="divide-y divide-[#E3D2B4] rounded border border-[#E3D2B4] bg-[#FFFDF8] text-xs">
              <div className="flex items-center justify-between p-2.5">
                <span className="text-[#6B5A4C] flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-[#165B33]" />
                  Faculty In-Charge:
                </span>
                <span className="font-bold text-[#165B33]">{selectedCourseModal.facultyName}</span>
              </div>
              <div className="flex items-center justify-between p-2.5">
                <span className="text-[#6B5A4C] flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#165B33]" />
                  Classroom / Lab:
                </span>
                <span className="font-semibold text-[#241710]">
                  {selectedCourseModal.code === 'BCBL504'
                    ? 'Old Re Lab'
                    : selectedCourseModal.code === 'BCS502'
                    ? `Lecture in ${classroomNo} / Lab in N2 Lab`
                    : classroomNo}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5">
                <span className="text-[#6B5A4C] flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-[#165B33]" />
                  Credits & Classification:
                </span>
                <span className="font-semibold text-[#241710]">
                  {selectedCourseModal.credits} Credits · {selectedCourseModal.type}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5">
                <span className="text-[#6B5A4C] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#165B33]" />
                  Validity:
                </span>
                <span className="font-semibold text-[#241710]">w.e.f: 07/09/2026</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSelectedCourseModal(null)}
                className="rounded border border-[#E3D2B4] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B5A4C] hover:bg-[#FFFDF8]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
