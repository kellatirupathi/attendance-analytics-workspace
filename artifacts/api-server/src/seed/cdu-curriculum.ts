export const CDU_CAMPUS = "Chaitanya Deemed-to-be University";

/** Curriculum subject → the subject name BigQuery stores. */
export const SUBJECT_TO_BIGQUERY: Record<string, string> = {
  DSA: "Design and Analysis of Algorithms",
  Backend: "Back End Development",
  Aptitude: "Logical Reasoning and Analytical Skills",
  Math: "Probability and Statistics",
  English: "Advanced Communication Skills",
  GenAI: "AI For Finance",
};

export const BIGQUERY_TO_CURRICULUM_SUBJECT = Object.fromEntries(
  Object.entries(SUBJECT_TO_BIGQUERY).map(([curriculumSubject, bigQuerySubject]) => [
    bigQuerySubject,
    curriculumSubject,
  ]),
) as Record<string, string>;

interface CurriculumSourceTopic {
  seq: number;
  week: number;
  module: string | null;
  topicTitle: string;
  unitId: string | null;
  duration: string | null;
}

const CDU_CURRICULUM_SOURCE: Record<string, CurriculumSourceTopic[]> = {
  "GenAI": [
    {
      "seq": 1,
      "week": 1,
      "module": null,
      "topicTitle": "Your Learning Journey",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 2,
      "week": 1,
      "module": null,
      "topicTitle": "Introduction to AI For Finance",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 3,
      "week": 1,
      "module": null,
      "topicTitle": "Building Personal Finance Advisor",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 4,
      "week": 2,
      "module": null,
      "topicTitle": "Introduction to RAG Evaluation",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 5,
      "week": 2,
      "module": null,
      "topicTitle": "Enhancing Productivity with AI",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 6,
      "week": 3,
      "module": null,
      "topicTitle": "Building a Trading Agent | Part 1",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 7,
      "week": 3,
      "module": null,
      "topicTitle": "Building a Trading Agent | Part 2",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 8,
      "week": 4,
      "module": null,
      "topicTitle": "Introduction to LLM Observability",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 9,
      "week": 4,
      "module": null,
      "topicTitle": "Integrating Langsmith with the trading Agent",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 10,
      "week": 5,
      "module": null,
      "topicTitle": "Building a Financial Fraud Detection Model | Part 1",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 11,
      "week": 5,
      "module": null,
      "topicTitle": "Building a Financial Fraud Detection Model | Part 2",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 12,
      "week": 6,
      "module": null,
      "topicTitle": "Evaluating the Financial Fraud Detection Model",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 13,
      "week": 7,
      "module": null,
      "topicTitle": "Building a Financial Fraud Detection Agent",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 14,
      "week": 7,
      "module": null,
      "topicTitle": "Introduction to AI Ethics",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 15,
      "week": 8,
      "module": null,
      "topicTitle": "Introduction to Responsible AI",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 16,
      "week": 8,
      "module": null,
      "topicTitle": "Building AI Guardrails | Part 1",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 17,
      "week": 9,
      "module": null,
      "topicTitle": "Building AI Guardrails | Part2",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 18,
      "week": 9,
      "module": null,
      "topicTitle": "AI Finance Add-On Session",
      "unitId": null,
      "duration": null
    }
  ],
  "Backend": [
    {
      "seq": 1,
      "week": 1,
      "module": "Introduction to Backend Development",
      "topicTitle": "Introduction to Backend Development",
      "unitId": "f96ff5f5-ce13-46a4-a497-62adba933a57",
      "duration": "60.0"
    },
    {
      "seq": 2,
      "week": 1,
      "module": "Introduction to Backend Development",
      "topicTitle": "Cloud IDE Walkthrough",
      "unitId": "6a3d1968-448a-4d16-a4ff-fdfad1780390",
      "duration": null
    },
    {
      "seq": 3,
      "week": 1,
      "module": "Introduction to ExpressJS",
      "topicTitle": "Introduction to Express JS",
      "unitId": "86d20fcd-8104-4b74-b06d-0bcd2c4b552e",
      "duration": "60.0"
    },
    {
      "seq": 4,
      "week": 1,
      "module": "Introduction to ExpressJS",
      "topicTitle": "Solving A Node JS Question In Cloud IDE",
      "unitId": "ad39846d-1680-4606-bb87-f7f6f6770e8d",
      "duration": null
    },
    {
      "seq": 5,
      "week": 1,
      "module": "Introduction to ExpressJS - 2",
      "topicTitle": "Introduction to Express JS | Part 2",
      "unitId": "69811f2c-6c61-4ae9-a333-a340d3202a8c",
      "duration": "60.0"
    },
    {
      "seq": 6,
      "week": 2,
      "module": "Introduction to ExpressJS - 2",
      "topicTitle": "Introduction to Express JS | Part 3",
      "unitId": "e54a915d-32c9-49df-9fa4-cc5f82b94e5d",
      "duration": null
    },
    {
      "seq": 7,
      "week": 2,
      "module": "REST APIs and Debugging",
      "topicTitle": "REST APIs",
      "unitId": "ab3a0f02-ecc4-45d8-b776-f6166addd99d",
      "duration": null
    },
    {
      "seq": 8,
      "week": 3,
      "module": "REST APIs and Debugging",
      "topicTitle": "Debugging Common Errors",
      "unitId": "0df25f59-b1da-495f-bb92-a76daea558d3",
      "duration": null
    },
    {
      "seq": 9,
      "week": 3,
      "module": "REST APIs and Debugging",
      "topicTitle": "Debugging Common Errors | Part 2",
      "unitId": "78d13ed8-ce49-4595-8955-d0b220ddc4dd",
      "duration": null
    },
    {
      "seq": 10,
      "week": 3,
      "module": "Authentication",
      "topicTitle": "Authentication",
      "unitId": "f8ac7ad5-ac7a-412a-863b-cfbe4bf01273",
      "duration": null
    },
    {
      "seq": 11,
      "week": 4,
      "module": "Authentication",
      "topicTitle": "Authentication | Part 2",
      "unitId": "d880ff06-02ba-4ddc-b733-b7f05de63617",
      "duration": null
    },
    {
      "seq": 12,
      "week": 4,
      "module": "Authentication",
      "topicTitle": "Authentication | Part 3",
      "unitId": "4b59520e-c00b-4cca-89b9-0ec77bec105f",
      "duration": null
    },
    {
      "seq": 13,
      "week": 5,
      "module": "File Systems & Streams",
      "topicTitle": "File Systems Part - 1",
      "unitId": "8ab1210b-c93f-44bf-8ccb-9a57af44a4f8",
      "duration": null
    },
    {
      "seq": 14,
      "week": 5,
      "module": "File Systems & Streams",
      "topicTitle": "File Systems Part - 2",
      "unitId": "64f07907-e26e-43de-b8a8-cb9e8a0dde42",
      "duration": null
    },
    {
      "seq": 15,
      "week": 5,
      "module": "File Systems & Streams",
      "topicTitle": "Streams",
      "unitId": "7db674ec-650a-43fe-896f-5657f93518db",
      "duration": null
    },
    {
      "seq": 16,
      "week": 6,
      "module": "MongoDB Integration with NodeJS",
      "topicTitle": "Connecting MongoDB to NodeJS",
      "unitId": "086ee1bf-a473-4813-9367-1fa634f70609",
      "duration": null
    },
    {
      "seq": 17,
      "week": 6,
      "module": "MongoDB Integration with NodeJS",
      "topicTitle": "Introduction to MVC and Mongoose Models",
      "unitId": "54907082-8a7a-4a36-b3bf-0582466b732a",
      "duration": null
    },
    {
      "seq": 18,
      "week": 6,
      "module": "MongoDB Integration with NodeJS",
      "topicTitle": "Implementing CRUD Operations | Part 1",
      "unitId": "12f6b539-f2a4-4297-891c-94a49d2d4501",
      "duration": null
    },
    {
      "seq": 19,
      "week": 7,
      "module": "MongoDB Integration with NodeJS",
      "topicTitle": "Implementing CRUD Operations | Part 2",
      "unitId": "18ca8a43-52aa-4940-8c0d-d0cb824655a6",
      "duration": null
    },
    {
      "seq": 20,
      "week": 7,
      "module": "MongoDB Integration with NodeJS",
      "topicTitle": "Filtering and Sorting",
      "unitId": "ef0b6d09-fe1b-4d85-8fa9-df1f416b23ae",
      "duration": null
    },
    {
      "seq": 21,
      "week": 8,
      "module": "MongoDB Integration with NodeJS",
      "topicTitle": "Protected Routes with JWT Authentication",
      "unitId": "08f4f820-d35c-49d2-8fc4-dae765bd54b3",
      "duration": null
    },
    {
      "seq": 22,
      "week": 8,
      "module": "MongoDB Integration with NodeJS",
      "topicTitle": "Role-Based Authorization",
      "unitId": "57a53301-d62a-4bfd-9f3c-a10d067f79d7",
      "duration": null
    }
  ],
  "English": [
    {
      "seq": 1,
      "week": 1,
      "module": "Accuracy in sentence structure\nAccuracy in Sentence Structure: Activity",
      "topicTitle": "Accuracy in sentence structure",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 2,
      "week": 1,
      "module": "The Language of Connection",
      "topicTitle": "The Language of Connection",
      "unitId": "5b98ba15-e9c3-483e-9eac-dafd31cb5dfc",
      "duration": null
    },
    {
      "seq": 3,
      "week": 2,
      "module": "Mastering the Art of Discussion\nMastering the Art of Discussion: Activity",
      "topicTitle": "Mastering the Art of Discussion",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 4,
      "week": 2,
      "module": "Designing Clear Prompts\nDesigning Clear Prompts: Activity",
      "topicTitle": "Designing Clear Prompts",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 5,
      "week": 2,
      "module": "Framing Effective Questions\nFraming Effective Questions: Activity",
      "topicTitle": "Framing Effective Questions",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 6,
      "week": 3,
      "module": "Emphasizing Self-Expression\nEmphasizing Self-Expression: Activity",
      "topicTitle": "Emphasizing Self-Expression",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 7,
      "week": 6,
      "module": "Expressing Possibility and Obligation\nExpressing Possibility and Obligation: Activity",
      "topicTitle": "Expressing Possibility and Obligation",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 8,
      "week": 6,
      "module": "Rephrasing Speech Accurately\nRephrasing Speech Accurately: Activity",
      "topicTitle": "Rephrasing Speech Accurately",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 9,
      "week": 7,
      "module": "Shifting Focus in Communication\nShifting Focus in Communication: Activity",
      "topicTitle": "Shifting Focus in Communication",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 10,
      "week": 7,
      "module": "Improving Natural Fluency\nImproving Natural Fluency: Activity",
      "topicTitle": "Improving Natural Fluency",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 11,
      "week": 8,
      "module": "Enhancing Communicative Style: Reading Material\nBalancing Ideas Clearly\nBalancing Ideas Clearly: Activity",
      "topicTitle": "Balancing Ideas Clearly",
      "unitId": null,
      "duration": null
    },
    {
      "seq": 12,
      "week": 8,
      "module": "Managing Hesitation and Emphasizing Key Points\nManaging Hesitation and Emphasizing Key Points: Activity",
      "topicTitle": "Managing Hesitation and Emphasizing Key Points",
      "unitId": null,
      "duration": null
    }
  ],
  "DSA": [
    {
      "seq": 1,
      "week": 1,
      "module": "Module V: Hashing, Sliding Window & Two-Pointer",
      "topicTitle": "Hashing",
      "unitId": "30982e6a-375b-45a4-97b1-0e3b447a7d2a",
      "duration": "0:57:03"
    },
    {
      "seq": 2,
      "week": 1,
      "module": "Module V: Hashing, Sliding Window & Two-Pointer",
      "topicTitle": "Prefix Sum",
      "unitId": "a7b2fb3a-e3aa-4723-a241-8f47574197f9",
      "duration": "0:47:40"
    },
    {
      "seq": 3,
      "week": 1,
      "module": "Module V: Hashing, Sliding Window & Two-Pointer",
      "topicTitle": "Sliding Window, Two-Pointer Technique",
      "unitId": "bc9f4ac1-9b60-43b9-9da3-b864a8ae993a",
      "duration": "0:40:19"
    },
    {
      "seq": 4,
      "week": 1,
      "module": "Module V: Hashing, Sliding Window & Two-Pointer",
      "topicTitle": "Longest Subarray with Sum K",
      "unitId": "07246cf4-f169-4951-818b-5f1cd75fb027",
      "duration": "1:03:45"
    },
    {
      "seq": 5,
      "week": 1,
      "module": "Module V: Hashing, Sliding Window & Two-Pointer",
      "topicTitle": "Largest Subarray Sum",
      "unitId": "e4775045-4cd6-44d3-ae93-0a283c0d806d",
      "duration": "0:32:22"
    },
    {
      "seq": 6,
      "week": 1,
      "module": "Module V: Hashing, Sliding Window & Two-Pointer",
      "topicTitle": "Two Sum",
      "unitId": "c4f3ed12-11aa-4e02-8f2a-45a07f2a6231",
      "duration": "0:43:51"
    },
    {
      "seq": 7,
      "week": 2,
      "module": "Module II: Linked Lists",
      "topicTitle": "Introduction to Linked List",
      "unitId": "c1eeeb97-2056-4790-ab30-ddeedbd2fe7f",
      "duration": "1:13:00"
    },
    {
      "seq": 8,
      "week": 2,
      "module": "Module II: Linked Lists",
      "topicTitle": "Insertion in Linked List",
      "unitId": "87f9912a-5ea7-4cba-9f22-7eb1c61cbdec",
      "duration": "0:57:34"
    },
    {
      "seq": 9,
      "week": 2,
      "module": "Module II: Linked Lists",
      "topicTitle": "Deletion in Linked List",
      "unitId": "7aa796a0-4bca-4b24-938a-3d2d7b63f5cb",
      "duration": "1:04:00"
    },
    {
      "seq": 10,
      "week": 2,
      "module": "Module II: Linked Lists",
      "topicTitle": "Introduction to Doubly Linked List",
      "unitId": "253000b6-2e61-4f93-8787-37bea8bdc1fe",
      "duration": "0:27:00"
    },
    {
      "seq": 11,
      "week": 2,
      "module": "Module II: Linked Lists",
      "topicTitle": "Insertion in Doubly Linked List",
      "unitId": "581a1a42-4bbf-4c3c-a35c-0d5566cdb9a5",
      "duration": "0:34:24"
    },
    {
      "seq": 12,
      "week": 2,
      "module": "Module II: Linked Lists",
      "topicTitle": "Deletion in Doubly Linked List",
      "unitId": "78d45cea-90ec-4a27-8a88-3a95aa91eec7",
      "duration": "0:49:00"
    },
    {
      "seq": 13,
      "week": 3,
      "module": "Module II: Linked Lists",
      "topicTitle": "Circular Linked List",
      "unitId": "6e70729e-77d7-44ec-9277-772b78ad94e7",
      "duration": null
    },
    {
      "seq": 14,
      "week": 3,
      "module": "Module II: Linked Lists",
      "topicTitle": "Reversing a Linked List",
      "unitId": "b8e28fb1-5748-4bb3-ac28-b1838f1de36a",
      "duration": null
    },
    {
      "seq": 15,
      "week": 3,
      "module": "Module II: Linked Lists",
      "topicTitle": "Cycle Detection In Linked List",
      "unitId": "0555c842-3dbe-4a42-8665-873f1cd88aee",
      "duration": null
    },
    {
      "seq": 16,
      "week": 3,
      "module": "Module II: Linked Lists",
      "topicTitle": "Length of Cycle In Linked List",
      "unitId": "cc9780ee-05d7-48e8-ae94-402fb54b3127",
      "duration": null
    },
    {
      "seq": 17,
      "week": 3,
      "module": "Module II: Linked Lists",
      "topicTitle": "Adding Two Numbers",
      "unitId": "9554a75f-0562-4c90-b67a-11edb23ce550",
      "duration": null
    },
    {
      "seq": 18,
      "week": 3,
      "module": "Module II: Linked Lists",
      "topicTitle": "Merge Two Sorted Linked List",
      "unitId": "17014d63-762d-43d5-86a5-96a0958eeec6",
      "duration": null
    },
    {
      "seq": 19,
      "week": 4,
      "module": "Module II: Linked Lists",
      "topicTitle": "Intersection Of Two Linked Lists",
      "unitId": "844405d6-3e3c-4793-865f-5ba028e43865",
      "duration": null
    },
    {
      "seq": 20,
      "week": 4,
      "module": "Module II: Linked Lists",
      "topicTitle": "Flatten a Linked List",
      "unitId": "f0bed3f3-f90a-4c46-98d9-3a8688d873be",
      "duration": null
    },
    {
      "seq": 21,
      "week": 4,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Stack Implementation Using Array",
      "unitId": "4aa9d6fa-3857-47ed-9f21-2df397cee883",
      "duration": null
    },
    {
      "seq": 22,
      "week": 4,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Stack Implementation Using Linked List",
      "unitId": "4b50cc7c-0254-4be8-ba6d-af806d9434ee",
      "duration": null
    },
    {
      "seq": 23,
      "week": 4,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Introduction to Monotonic Stacks",
      "unitId": "07c8f2bc-396b-4df1-97f1-2a731bd27fe3",
      "duration": null
    },
    {
      "seq": 24,
      "week": 5,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Infix, Prefix, and Postfix Notations",
      "unitId": "5d17cca8-e827-460f-bda4-1e98fff12755",
      "duration": null
    },
    {
      "seq": 25,
      "week": 5,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Implement Min Stack",
      "unitId": "94135436-b8d5-44b3-acc6-e0a1bc6e3523",
      "duration": null
    },
    {
      "seq": 26,
      "week": 5,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Balanced Parenthesis",
      "unitId": "62e7b259-70f8-407d-861f-2086d0053dcd",
      "duration": "0:34:04"
    },
    {
      "seq": 27,
      "week": 5,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Asteroid Collision",
      "unitId": "c3231d08-d11d-44f1-a88f-87643172ea96",
      "duration": "0:24:55"
    },
    {
      "seq": 28,
      "week": 5,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Largest Rectangle In Histogram",
      "unitId": "ec7d727f-3233-4489-8145-c33ff54e54d5",
      "duration": "0:29:00"
    },
    {
      "seq": 29,
      "week": 5,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Queue - Introduction & Implementation Using Arrays",
      "unitId": "3386ad2f-071a-47ca-ab74-d5a73d31c5b0",
      "duration": "0:43:23"
    },
    {
      "seq": 30,
      "week": 6,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Queue Implementation Using Linked List",
      "unitId": "83d071ae-5456-484c-a65b-7a264d7909f8",
      "duration": "0:29:44"
    },
    {
      "seq": 31,
      "week": 6,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Implement Stack Using Queue",
      "unitId": "186fd8d0-4b98-4643-afb0-5d8962bce01d",
      "duration": null
    },
    {
      "seq": 32,
      "week": 6,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Implement Queue Using Stack - Part - 1",
      "unitId": "a6fda753-2ee8-4263-894a-699f9db5971a",
      "duration": null
    },
    {
      "seq": 33,
      "week": 6,
      "module": "Module III: Stacks & Queues",
      "topicTitle": "Implement Queue Using Stack - Part - 2",
      "unitId": "bb0389c2-2af9-437b-819e-9e3d165b29de",
      "duration": "0:10:54"
    },
    {
      "seq": 34,
      "week": 6,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Introduction to Binary Trees",
      "unitId": "a25d2d17-2163-41b6-8517-3eb586f60e6e",
      "duration": null
    },
    {
      "seq": 35,
      "week": 6,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Binary Tree Traversals",
      "unitId": "26262c62-0f31-4a88-ae9f-db0f6f46af15",
      "duration": null
    },
    {
      "seq": 36,
      "week": 6,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Pre-Order Traversal",
      "unitId": "a75602b5-47e8-4921-b4d1-62d59a25ed93",
      "duration": null
    },
    {
      "seq": 37,
      "week": 7,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "In-Order Traversal",
      "unitId": "ec6e71a9-d5dd-4d58-9e5a-3612f7e65b19",
      "duration": null
    },
    {
      "seq": 38,
      "week": 7,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Post-Order Traversal",
      "unitId": "99e859a9-98ed-41a2-a1e3-b664daef3c12",
      "duration": null
    },
    {
      "seq": 39,
      "week": 7,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Level Order Traversal",
      "unitId": "64b29ae7-9288-4d32-9f8d-a10165418c46",
      "duration": null
    },
    {
      "seq": 40,
      "week": 7,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Height of a Binary Tree",
      "unitId": "ae241876-99cf-4c34-95d6-bd20986ed9e4",
      "duration": null
    },
    {
      "seq": 41,
      "week": 7,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Balanced Binary Tree",
      "unitId": "f15b86c0-770a-4e04-a188-00ea0d87ff99",
      "duration": null
    },
    {
      "seq": 42,
      "week": 7,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Diameter Of Binary Tree",
      "unitId": "07ecaacc-dc2e-4b38-8a7a-e2989d07289f",
      "duration": null
    },
    {
      "seq": 43,
      "week": 8,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Maximum Path Sum of Binary Tree",
      "unitId": "78800212-a962-48d2-957c-9fae7d593712",
      "duration": null
    },
    {
      "seq": 44,
      "week": 8,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Top view of Binary Tree",
      "unitId": "20047473-f5db-443a-9f09-d5df9ce76fd7",
      "duration": null
    },
    {
      "seq": 45,
      "week": 8,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Right view of Binary Tree",
      "unitId": "a4b00a46-0817-47d2-a45f-d556b89d5f21",
      "duration": null
    },
    {
      "seq": 46,
      "week": 8,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Lowest Common Ancestor of a Binary Tree",
      "unitId": "53965a42-2836-47c8-a462-193d546961db",
      "duration": null
    },
    {
      "seq": 47,
      "week": 8,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Introduction to Binary Search Tree",
      "unitId": "3b63404c-4618-4518-acab-dc9d3fb67baa",
      "duration": null
    },
    {
      "seq": 48,
      "week": 8,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Insertion in Binary Search Tree",
      "unitId": "e065c5af-d030-4537-a9da-11a71234c495",
      "duration": null
    },
    {
      "seq": 49,
      "week": 9,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Deletion in Binary Search Tree",
      "unitId": "6076ce68-63c5-43e6-974a-1b38d3c4475e",
      "duration": null
    },
    {
      "seq": 50,
      "week": 9,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Kth Smallest Element in BST",
      "unitId": "bbea3156-a662-48e5-bb3e-0f8e2f16372c",
      "duration": null
    },
    {
      "seq": 51,
      "week": 9,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Validate a Binary Search Tree",
      "unitId": "040714f2-1dd8-4a12-9c8c-84c6d5e20f76",
      "duration": null
    },
    {
      "seq": 52,
      "week": 9,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Predecessor and Successor in BST",
      "unitId": "82e8c910-9fd0-45ce-9480-7ff66b0ea535",
      "duration": null
    },
    {
      "seq": 53,
      "week": 9,
      "module": "Module IV: Trees & Binary Search Trees",
      "topicTitle": "Merge Two BSTs",
      "unitId": "bdfe95bc-328d-42bd-a037-8d4e8388ecd0",
      "duration": null
    },
    {
      "seq": 54,
      "week": 9,
      "module": "Module V: Heaps",
      "topicTitle": "Introduction to Heaps",
      "unitId": "6677c40b-efcc-4de8-8d5b-5634dd921d30",
      "duration": null
    },
    {
      "seq": 55,
      "week": 10,
      "module": "Module V: Heaps",
      "topicTitle": "Implementation of Binary Heap",
      "unitId": "6062b6a3-274b-40a9-bb77-22efad6d0c42",
      "duration": null
    },
    {
      "seq": 56,
      "week": 10,
      "module": "Module V: Heaps",
      "topicTitle": "Heapsort Algorithm",
      "unitId": "ea4fef16-7357-4235-9522-9fdf593081fc",
      "duration": null
    },
    {
      "seq": 57,
      "week": 10,
      "module": "Module V: Heaps",
      "topicTitle": "Max Heap Validation",
      "unitId": "bd02361e-7f01-43db-88ba-ce22323b0e30",
      "duration": null
    },
    {
      "seq": 58,
      "week": 10,
      "module": "Module V: Heaps",
      "topicTitle": "Convert Min Heap to Max Heap",
      "unitId": "8895872b-bd19-41d6-b3af-ff41bd733074",
      "duration": null
    },
    {
      "seq": 59,
      "week": 10,
      "module": "Module V: Heaps",
      "topicTitle": "Kth Largest Element in an Array Part 1",
      "unitId": "4c24d406-08de-4b35-a169-fc3005faab33",
      "duration": "0:07:21"
    },
    {
      "seq": 60,
      "week": 10,
      "module": "Module V: Heaps",
      "topicTitle": "Kth Largest Element in an Array Part 2",
      "unitId": "29ae2136-e3a3-4c56-8e9d-8a831e22071c",
      "duration": null
    },
    {
      "seq": 61,
      "week": 10,
      "module": "Module V: Heaps",
      "topicTitle": "Merge K Sorted Arrays",
      "unitId": "66501e9f-91ab-4715-bc2c-ae6de0c92464",
      "duration": null
    },
    {
      "seq": 62,
      "week": 10,
      "module": "Module V: Heaps",
      "topicTitle": "Top K Frequent Elements",
      "unitId": "e8b03260-0e68-418b-9e39-2264a00c2df8",
      "duration": null
    }
  ],
  "Aptitude": [
    {
      "seq": 1,
      "week": 1,
      "module": "Introduction",
      "topicTitle": "Introduction",
      "unitId": "11702c78-8d2f-42d2-98ba-ff5ce60b1ee6",
      "duration": "60.0"
    },
    {
      "seq": 2,
      "week": 1,
      "module": "Data Arrangements",
      "topicTitle": "Linear Arrangements",
      "unitId": "18e0bff7-be6b-4808-a7aa-0e39c4e36d50",
      "duration": "60.0"
    },
    {
      "seq": 3,
      "week": 1,
      "module": "Data Arrangements",
      "topicTitle": "Circular Arrangements",
      "unitId": "96c7b735-0ace-470c-9101-332f5c6ae8c3",
      "duration": "60.0"
    },
    {
      "seq": 4,
      "week": 2,
      "module": "Blood Relations",
      "topicTitle": "Blood Relations 1",
      "unitId": "518a02b2-c5b6-498d-99be-925ab4fbb683",
      "duration": "60.0"
    },
    {
      "seq": 5,
      "week": 3,
      "module": "Blood Relations",
      "topicTitle": "Blood Relations 2",
      "unitId": "76613305-b776-4871-8829-d012e1620200",
      "duration": "60.0"
    },
    {
      "seq": 6,
      "week": 3,
      "module": "Blood Relations",
      "topicTitle": "Company Specific Session - Arrangements & Blood relations",
      "unitId": "16beb9ea-81de-41ce-8e7e-02941fec3051",
      "duration": "60.0"
    },
    {
      "seq": 7,
      "week": 4,
      "module": "Venn Diagrams",
      "topicTitle": "Venn Diagrams",
      "unitId": "c524720d-a40f-407f-8de1-2f20112111c2",
      "duration": "60.0"
    },
    {
      "seq": 8,
      "week": 5,
      "module": "Syllogisms",
      "topicTitle": "Syllogisms 1",
      "unitId": "8ea5b9ce-397a-4aaf-a9d4-a0fe0da7992c",
      "duration": "60.0"
    },
    {
      "seq": 9,
      "week": 5,
      "module": "Syllogisms",
      "topicTitle": "Syllogisms 2",
      "unitId": "8da023e3-d1a8-4745-864a-a668346eef19",
      "duration": "60.0"
    },
    {
      "seq": 10,
      "week": 6,
      "module": "Cubes",
      "topicTitle": "Cubes",
      "unitId": "31f40562-2a7a-4f2b-92cf-94e2e6351449",
      "duration": "60.0"
    },
    {
      "seq": 11,
      "week": 6,
      "module": "Cubes",
      "topicTitle": "Company Specific Session - Venn Diagrams, Syllogisms, Cubes",
      "unitId": "5db32318-168e-4851-9c7d-bf799930e623",
      "duration": "60.0"
    },
    {
      "seq": 12,
      "week": 7,
      "module": "Puzzles",
      "topicTitle": "Puzzles",
      "unitId": "8eb2f44b-0b13-49f1-9165-59b717866775",
      "duration": "60.0"
    },
    {
      "seq": 13,
      "week": 8,
      "module": "Data Sufficiency",
      "topicTitle": "Data Sufficiency",
      "unitId": "e58078fd-622b-4b6e-a927-5ade68fc03d0",
      "duration": "60.0"
    },
    {
      "seq": 14,
      "week": 9,
      "module": "Data Sufficiency",
      "topicTitle": "Company Specific Session - Puzzles & Data Sufficiency",
      "unitId": "333ce9ac-fcfc-4b34-874d-2c44a2ae9c4a",
      "duration": "60.0"
    },
    {
      "seq": 15,
      "week": 9,
      "module": "Counting Figures",
      "topicTitle": "Counting Figures",
      "unitId": "a9b8a3c4-09ff-4537-b76f-fb7fb2a7bbdd",
      "duration": "60.0"
    },
    {
      "seq": 16,
      "week": 10,
      "module": "Visual Reasoning",
      "topicTitle": "Visual Reasoning",
      "unitId": "50fb32f5-9547-4857-84a6-01ac5a20d5f5",
      "duration": "60.0"
    }
  ],
  "Math": [
    {
      "seq": 1,
      "week": 1,
      "module": "Descriptive Statistics",
      "topicTitle": "Introduction to Probability & Statistics in ML",
      "unitId": "4bae337e-df6d-4a6e-9d63-875563343238",
      "duration": "31.0"
    },
    {
      "seq": 2,
      "week": 1,
      "module": "Descriptive Statistics",
      "topicTitle": "Introduction to Statistics & Datasets",
      "unitId": "419072ad-5a67-4cce-b15c-c6ad788ed10a",
      "duration": "27.0"
    },
    {
      "seq": 3,
      "week": 1,
      "module": "Descriptive Statistics",
      "topicTitle": "Data Visualization - I",
      "unitId": "afbbebe6-324c-4c39-b4e5-74b6102269af",
      "duration": "31.0"
    },
    {
      "seq": 4,
      "week": 1,
      "module": "Descriptive Statistics",
      "topicTitle": "Data Visualization - II",
      "unitId": "ee98a978-e592-47b0-99a5-dee02195a052",
      "duration": "30.0"
    },
    {
      "seq": 5,
      "week": 1,
      "module": "Descriptive Statistics",
      "topicTitle": "Data Visualization Implementation",
      "unitId": "c7bc7729-d4a8-4692-b398-a57d71ff0e1d",
      "duration": "51.0"
    },
    {
      "seq": 6,
      "week": 2,
      "module": "Descriptive Statistics",
      "topicTitle": "Measures of Central Tendency",
      "unitId": "85a5e120-ef21-45ca-9907-be323dfc4ac9",
      "duration": "37.0"
    },
    {
      "seq": 7,
      "week": 2,
      "module": "Descriptive Statistics",
      "topicTitle": "Measures of Central Tendency Implementation",
      "unitId": "0a03c279-b3e7-4b81-900a-ebe73b99d9ea",
      "duration": "26.0"
    },
    {
      "seq": 8,
      "week": 2,
      "module": "Descriptive Statistics",
      "topicTitle": "Measures of Variability",
      "unitId": "1bf391f3-2514-4adf-9397-2ba7c02277df",
      "duration": "52.0"
    },
    {
      "seq": 9,
      "week": 2,
      "module": "Descriptive Statistics",
      "topicTitle": "Skewness and Outliers",
      "unitId": "975ecf7a-f669-489a-b619-cabe1af14fae",
      "duration": "26.0"
    },
    {
      "seq": 10,
      "week": 3,
      "module": "Descriptive Statistics",
      "topicTitle": "Measures of Variability Implementation",
      "unitId": "de6d97fe-1d8a-406e-866a-35511b04e15f",
      "duration": "28.0"
    },
    {
      "seq": 11,
      "week": 3,
      "module": "Fundamentals of Probability",
      "topicTitle": "Basics of Probability",
      "unitId": "2e520ed5-e7ce-4418-8584-58c6f61be5f2",
      "duration": "48.0"
    },
    {
      "seq": 12,
      "week": 3,
      "module": "Fundamentals of Probability",
      "topicTitle": "Probability Rules & Theorems",
      "unitId": "a9c334dd-d2ae-4e9a-aecd-995dcd8b239b",
      "duration": "32.0"
    },
    {
      "seq": 13,
      "week": 4,
      "module": "Fundamentals of Probability",
      "topicTitle": "Conditional Probability",
      "unitId": "a94464fb-bfd0-45d3-9af8-94cb170ff6f7",
      "duration": "21.0"
    },
    {
      "seq": 14,
      "week": 4,
      "module": "Fundamentals of Probability",
      "topicTitle": "Law of Partition and Total Probability",
      "unitId": "62bcd4c9-33a0-4a5d-8cb4-47cba3d30ce2",
      "duration": "24.0"
    },
    {
      "seq": 15,
      "week": 4,
      "module": "Descriptive Statistics",
      "topicTitle": "Skewness & Outliers Implementation",
      "unitId": "35480814-33d0-4b72-a17c-2681ca9d6d1d",
      "duration": "39.0"
    },
    {
      "seq": 16,
      "week": 5,
      "module": "Fundamentals of Probability",
      "topicTitle": "Baye's Theorem and counting principles",
      "unitId": "0e93171a-f242-4f74-a587-34dceae3638a",
      "duration": "33.0"
    },
    {
      "seq": 17,
      "week": 5,
      "module": "Random Variables & Probability Distributions",
      "topicTitle": "Discrete Random Variables",
      "unitId": "93281bc2-f83e-4bc2-840d-6364c625afa0",
      "duration": "19.0"
    },
    {
      "seq": 18,
      "week": 5,
      "module": "Random Variables & Probability Distributions",
      "topicTitle": "Continuous Random Variables",
      "unitId": "dcbb9b55-2490-4bec-b7b2-cd5397d25833",
      "duration": "29.0"
    },
    {
      "seq": 19,
      "week": 5,
      "module": "Random Variables & Probability Distributions",
      "topicTitle": "Binomial Distribution",
      "unitId": "1b033b0c-bcc4-4ff1-aa65-c96d3bfc7e7c",
      "duration": "41.0"
    },
    {
      "seq": 20,
      "week": 5,
      "module": "Fundamentals of Probability",
      "topicTitle": "Fundamentals of Probability Implementation",
      "unitId": "a0c30afb-ae3a-41e9-a3cd-ca6dee254cf5",
      "duration": "33.0"
    },
    {
      "seq": 21,
      "week": 6,
      "module": "Random Variables & Probability Distributions",
      "topicTitle": "Poisson Distribution",
      "unitId": "0eb04556-9cca-43d2-8cd5-8b58fa5709fe",
      "duration": "27.0"
    },
    {
      "seq": 22,
      "week": 6,
      "module": "Random Variables & Probability Distributions",
      "topicTitle": "Normal Distribution - I",
      "unitId": "ddf6abff-7815-46aa-bf20-0b071bc65c6b",
      "duration": "46.0"
    },
    {
      "seq": 23,
      "week": 6,
      "module": "Random Variables & Probability Distributions",
      "topicTitle": "Normal Distribution - II",
      "unitId": "16dcf874-eebe-4f0a-a3b3-905d47deab83",
      "duration": "23.0"
    },
    {
      "seq": 24,
      "week": 7,
      "module": "Random Variables & Probability Distributions",
      "topicTitle": "Other Continuous Probability Distributions",
      "unitId": "b03833b8-fc09-45ec-89b6-fde7c3f13e1f",
      "duration": "34.0"
    },
    {
      "seq": 25,
      "week": 7,
      "module": "Random Variables & Probability Distributions",
      "topicTitle": "Probability Distributions Implementation",
      "unitId": "102b1a11-349c-4b6a-8f4a-67a1822f653a",
      "duration": "61.0"
    },
    {
      "seq": 26,
      "week": 8,
      "module": "Inferential Statistics",
      "topicTitle": "Introduction to Inferential Statistics",
      "unitId": "98c7bfe5-49d6-4cf2-889c-2c2a80600335",
      "duration": "23.0"
    },
    {
      "seq": 27,
      "week": 8,
      "module": "Inferential Statistics",
      "topicTitle": "Introduction to Sampling",
      "unitId": "d4e3ae47-3b40-4488-8537-a1f27b01c4c5",
      "duration": "26.0"
    },
    {
      "seq": 28,
      "week": 8,
      "module": "Inferential Statistics",
      "topicTitle": "Sampling Distribution",
      "unitId": "d47eb0e9-f2e6-458e-aca3-afd19e857359",
      "duration": "23.0"
    },
    {
      "seq": 29,
      "week": 8,
      "module": "Inferential Statistics",
      "topicTitle": "Sampling Distribution - Central limit theorem Implementation",
      "unitId": "1d5aaacf-8eb2-4b9b-bc48-9d589aeb6e0a",
      "duration": "40.0"
    },
    {
      "seq": 30,
      "week": 8,
      "module": "Inferential Statistics",
      "topicTitle": "Confidence Intervals & Confidence Levels",
      "unitId": "a9e7dc2d-5a31-4bd8-a6b6-9c8e84a8e23b",
      "duration": "40.0"
    },
    {
      "seq": 31,
      "week": 9,
      "module": "Inferential Statistics",
      "topicTitle": "Testing of Hypothesis - Mean",
      "unitId": "51d8671e-64e2-4a30-94b6-7e2f0d82b6a3",
      "duration": "50.0"
    },
    {
      "seq": 32,
      "week": 9,
      "module": "Inferential Statistics",
      "topicTitle": "Testing of Hypothesis - Difference of Means",
      "unitId": null,
      "duration": "47.0"
    }
  ]
};

export const CDU_CURRICULUM = Object.entries(CDU_CURRICULUM_SOURCE).flatMap(
  ([subject, topics]) =>
    topics.map((topic) => ({
      campus: CDU_CAMPUS,
      subject,
      sequenceNo: topic.seq,
      weekNo: topic.week,
      moduleName: topic.module,
      topicTitle: topic.topicTitle,
      unitId: topic.unitId,
    })),
);