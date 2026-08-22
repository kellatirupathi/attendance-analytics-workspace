// AUTO-GENERATED from CDU_PROD_SEQUENCE_SEM-3.xlsx, sheet 'finalized instructor count'.
//
// The campus instructor roster: who is on staff for each subject, and which
// sections they teach. Used to classify a recovery session's instructor as
// CAMPUS (on this roster) or BACKUP (brought in to cover).
//
// Names here are informal and come from a spreadsheet ('Divya', 'Jammu',
// 'Izhar'), while recovery sessions record fuller names ('Divya Partipati',
// 'Jammu Tejaswini'). Matching is therefore fuzzy — see the classification note
// in the spec, and treat the result as a suggestion a human can override.

import { CDU_CAMPUS } from "./cdu-curriculum.js";

export interface CampusInstructor {
  campus: string;
  subject: string;
  instructorName: string;
  /** Sections they teach. Empty where the roster listed no allocation. */
  sections: string[];
}

export const CDU_CAMPUS_INSTRUCTORS: CampusInstructor[] = [
  // ── DSA ──
  { campus: CDU_CAMPUS, subject: "DSA", instructorName: "Adithya ram Netturi", sections: ["CDU Batch-1 - S-005", "CDU Batch-1 - S-006", "CDU Batch-1 - S-007", "CDU Batch-1 - S-008"] },
  { campus: CDU_CAMPUS, subject: "DSA", instructorName: "Attar Asif", sections: ["CDU Batch-1 - S-001", "CDU Batch-1 - S-002", "CDU Batch-1 - S-003", "CDU Batch-1 - S-004"] },
  { campus: CDU_CAMPUS, subject: "DSA", instructorName: "Anas", sections: ["CDU Batch-1 - S-009", "CDU Batch-1 - S-010", "CDU Batch-1 - S-011", "CDU Batch-1 - S-012"] },
  { campus: CDU_CAMPUS, subject: "DSA", instructorName: "Shravya", sections: ["CDU Batch-1 - S-013", "CDU Batch-1 - S-014", "CDU Batch-1 - S-015", "CDU Batch-1 - S-016"] },
  { campus: CDU_CAMPUS, subject: "DSA", instructorName: "Ragavendhra", sections: ["CDU Batch-1 - S-017", "CDU Batch-1 - S-018", "CDU Batch-1 - S-019", "CDU Batch-1 - S-020"] },
  { campus: CDU_CAMPUS, subject: "DSA", instructorName: "Harsha Vardhan", sections: [] },
  // ── Backend ──
  { campus: CDU_CAMPUS, subject: "Backend", instructorName: "Divya", sections: ["CDU Batch-1 - S-001", "CDU Batch-1 - S-002", "CDU Batch-1 - S-003", "CDU Batch-1 - S-004"] },
  { campus: CDU_CAMPUS, subject: "Backend", instructorName: "Kavya", sections: ["CDU Batch-1 - S-005", "CDU Batch-1 - S-006", "CDU Batch-1 - S-007", "CDU Batch-1 - S-008"] },
  { campus: CDU_CAMPUS, subject: "Backend", instructorName: "Avinash", sections: ["CDU Batch-1 - S-009", "CDU Batch-1 - S-010", "CDU Batch-1 - S-011", "CDU Batch-1 - S-012"] },
  { campus: CDU_CAMPUS, subject: "Backend", instructorName: "Sindhu", sections: ["CDU Batch-1 - S-013", "CDU Batch-1 - S-014", "CDU Batch-1 - S-015", "CDU Batch-1 - S-016"] },
  { campus: CDU_CAMPUS, subject: "Backend", instructorName: "Ayan", sections: ["CDU Batch-1 - S-017", "CDU Batch-1 - S-018", "CDU Batch-1 - S-019", "CDU Batch-1 - S-020"] },
  // ── Aptitude ──
  { campus: CDU_CAMPUS, subject: "Aptitude", instructorName: "Jammu", sections: ["CDU Batch-1 - S-001", "CDU Batch-1 - S-002", "CDU Batch-1 - S-003", "CDU Batch-1 - S-004", "CDU Batch-1 - S-005"] },
  { campus: CDU_CAMPUS, subject: "Aptitude", instructorName: "Jaswanth", sections: ["CDU Batch-1 - S-006", "CDU Batch-1 - S-007", "CDU Batch-1 - S-008", "CDU Batch-1 - S-009", "CDU Batch-1 - S-010"] },
  { campus: CDU_CAMPUS, subject: "Aptitude", instructorName: "Sai Kiran Garipelly", sections: ["CDU Batch-1 - S-011", "CDU Batch-1 - S-012", "CDU Batch-1 - S-013", "CDU Batch-1 - S-014", "CDU Batch-1 - S-015"] },
  { campus: CDU_CAMPUS, subject: "Aptitude", instructorName: "Akhila", sections: ["CDU Batch-1 - S-016", "CDU Batch-1 - S-017", "CDU Batch-1 - S-018", "CDU Batch-1 - S-019", "CDU Batch-1 - S-020"] },
  // ── English ──
  { campus: CDU_CAMPUS, subject: "English", instructorName: "Sai Sree Tejaswini", sections: ["CDU Batch-1 - S-001", "CDU Batch-1 - S-002", "CDU Batch-1 - S-003", "CDU Batch-1 - S-004", "CDU Batch-1 - S-005", "CDU Batch-1 - S-006", "CDU Batch-1 - S-019"] },
  { campus: CDU_CAMPUS, subject: "English", instructorName: "Likhitha", sections: ["CDU Batch-1 - S-007", "CDU Batch-1 - S-008", "CDU Batch-1 - S-009", "CDU Batch-1 - S-010", "CDU Batch-1 - S-011", "CDU Batch-1 - S-012"] },
  { campus: CDU_CAMPUS, subject: "English", instructorName: "Sara Mariyam", sections: ["CDU Batch-1 - S-013", "CDU Batch-1 - S-014", "CDU Batch-1 - S-015", "CDU Batch-1 - S-016", "CDU Batch-1 - S-017", "CDU Batch-1 - S-018", "CDU Batch-1 - S-020"] },
  // ── GenAI ──
  { campus: CDU_CAMPUS, subject: "GenAI", instructorName: "Mubashira", sections: ["CDU Batch-1 - S-001", "CDU Batch-1 - S-002", "CDU Batch-1 - S-003", "CDU Batch-1 - S-004", "CDU Batch-1 - S-005", "CDU Batch-1 - S-006", "CDU Batch-1 - S-019"] },
  { campus: CDU_CAMPUS, subject: "GenAI", instructorName: "Abdullah", sections: ["CDU Batch-1 - S-007", "CDU Batch-1 - S-008", "CDU Batch-1 - S-009", "CDU Batch-1 - S-010", "CDU Batch-1 - S-011", "CDU Batch-1 - S-012"] },
  { campus: CDU_CAMPUS, subject: "GenAI", instructorName: "Izhar", sections: ["CDU Batch-1 - S-013", "CDU Batch-1 - S-014", "CDU Batch-1 - S-015", "CDU Batch-1 - S-016", "CDU Batch-1 - S-017", "CDU Batch-1 - S-018", "CDU Batch-1 - S-020"] },
  // ── Math ──
  { campus: CDU_CAMPUS, subject: "Math", instructorName: "Mir Nabeel Uddin", sections: ["CDU Batch-1 - S-001", "CDU Batch-1 - S-002", "CDU Batch-1 - S-003", "CDU Batch-1 - S-004", "CDU Batch-1 - S-005", "CDU Batch-1 - S-006", "CDU Batch-1 - S-019"] },
  { campus: CDU_CAMPUS, subject: "Math", instructorName: "Suraj Neerati", sections: ["CDU Batch-1 - S-007", "CDU Batch-1 - S-008", "CDU Batch-1 - S-009", "CDU Batch-1 - S-010", "CDU Batch-1 - S-011", "CDU Batch-1 - S-012"] },
  { campus: CDU_CAMPUS, subject: "Math", instructorName: "Jyotirmayee Sahoo", sections: ["CDU Batch-1 - S-013", "CDU Batch-1 - S-014", "CDU Batch-1 - S-015", "CDU Batch-1 - S-016", "CDU Batch-1 - S-017", "CDU Batch-1 - S-018", "CDU Batch-1 - S-020"] },
];