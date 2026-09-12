import React, { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Loader2, MapPin, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface RecoveryTopic {
  id: string;
  sequenceNo: number;
  title: string;
  order: number;
}

interface RecoverySession {
  id: string;
  campus: string;
  subject: string;
  section: string | null;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  studentsExpected: number | null;
  topics: RecoveryTopic[];
}

interface CurriculumGroup {
  campus: string;
  subject: string;
  topics: Array<{
    id: string;
    sequenceNo: number;
    weekNo: number | null;
    title: string;
  }>;
}

function formatTime(value: string): string {
  if (!value) return "";
  const [hourString, minute = "00"] = value.split(":");
  const hour = Number(hourString);
  if (!Number.isFinite(hour)) return value;
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

export default function InstructorRecovery() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<RecoverySession[]>([]);
  const [curriculum, setCurriculum] = useState<CurriculumGroup[]>([]);
  const [coveredBySession, setCoveredBySession] = useState<Record<string, Set<string>>>({});
  const [attendanceBySession, setAttendanceBySession] = useState<Record<string, string>>({});
  const [remarksBySession, setRemarksBySession] = useState<Record<string, string>>({});
  const [qaLinksBySession, setQaLinksBySession] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const [sessionsResponse, curriculumResponse] = await Promise.all([
        fetch("/api/recovery/instructor/sessions", { credentials: "include" }),
        fetch("/api/recovery/instructor/curriculum", { credentials: "include" }),
      ]);
      if (!sessionsResponse.ok) throw new Error((await sessionsResponse.json()).error ?? "Could not load today's sessions");
      if (!curriculumResponse.ok) throw new Error((await curriculumResponse.json()).error ?? "Could not load your curriculum");
      setSessions(await sessionsResponse.json() as RecoverySession[]);
      setCurriculum(await curriculumResponse.json() as CurriculumGroup[]);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not load sessions",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  const toggleTopic = (sessionId: string, topicId: string, checked: boolean) => {
    setCoveredBySession((current) => {
      const next = new Set(current[sessionId] ?? []);
      if (checked) next.add(topicId);
      else next.delete(topicId);
      return { ...current, [sessionId]: next };
    });
  };

  const submit = async (recoverySession: RecoverySession) => {
    const rawAttendance = attendanceBySession[recoverySession.id] ?? "";
    const studentsAttended = rawAttendance === "" ? undefined : Number(rawAttendance);
    if (studentsAttended != null && (!Number.isInteger(studentsAttended) || studentsAttended < 0)) {
      toast({ variant: "destructive", title: "Enter a valid attendance count" });
      return;
    }
    const coveredTopicIds = [...(coveredBySession[recoverySession.id] ?? [])];
    const remarks = (remarksBySession[recoverySession.id] ?? "").trim();
    // Mirrors the server-side check: a session that isn't fully covered
    // needs a remark on record explaining what happened to the rest.
    if (coveredTopicIds.length < recoverySession.topics.length && !remarks) {
      toast({
        variant: "destructive",
        title: "Add a remark",
        description: "Explain what happened to the topic(s) you didn't cover.",
      });
      return;
    }
    const qaReportUrls = (qaLinksBySession[recoverySession.id] ?? "")
      .split(/[\n,]/)
      .map((url) => url.trim())
      .filter(Boolean);
    if (qaReportUrls.some((url) => !/^https?:\/\/\S+$/i.test(url))) {
      toast({
        variant: "destructive",
        title: "Invalid QA report link",
        description: "Links must start with http:// or https://",
      });
      return;
    }
    setSubmitting(recoverySession.id);
    try {
      const response = await fetch(`/api/recovery/sessions/${recoverySession.id}/report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coveredTopicIds,
          remarks,
          qaReportUrls,
          ...(studentsAttended == null ? {} : { studentsAttended }),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not submit report");
      toast({ title: "Report submitted", description: "The recovery queue has been updated." });
      setSessions((current) => current.filter((item) => item.id !== recoverySession.id));
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Report not submitted",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-10 sm:px-6">
      <PageHeader
        badge="Instructor"
        title="Today's recovery sessions"
        subtitle="Check the topics you covered, add attendance, and submit before you leave class."
      />

      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
        </div>
      ) : sessions.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-600" />
            <h2 className="font-semibold text-slate-900">No pending session for today</h2>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              You have no assigned recovery class to report, or today’s report is already complete.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 space-y-5">
          {sessions.map((recoverySession) => {
            const selected = coveredBySession[recoverySession.id] ?? new Set<string>();
            return (
              <Card key={recoverySession.id} className="overflow-hidden">
                <CardHeader className="border-b border-slate-100 bg-slate-50 pb-5">
                  <CardTitle className="text-lg">{recoverySession.subject}</CardTitle>
                  <div className="grid gap-2 pt-2 text-sm text-slate-600 sm:grid-cols-2">
                    <span className="flex items-center gap-2"><MapPin className="h-4 w-4" />{recoverySession.campus}</span>
                    <span className="flex items-center gap-2"><Clock3 className="h-4 w-4" />{formatTime(recoverySession.startTime)}–{formatTime(recoverySession.endTime)}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {recoverySession.section ? `Section ${recoverySession.section}` : "All assigned sections"}
                  </p>
                </CardHeader>
                <CardContent className="space-y-6">
                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <Label className="text-sm font-semibold">Topics covered</Label>
                      <span className="text-xs text-slate-500">{selected.size} of {recoverySession.topics.length}</span>
                    </div>
                    <div className="space-y-2">
                      {recoverySession.topics.map((topic) => (
                        <label key={topic.id} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-brand-300">
                          <Checkbox
                            checked={selected.has(topic.id)}
                            onCheckedChange={(checked) => toggleTopic(recoverySession.id, topic.id, checked === true)}
                            className="h-5 w-5"
                          />
                          <span className="flex-1 text-sm font-medium leading-snug text-slate-800">
                            <span className="mr-2 text-slate-400">#{topic.sequenceNo}</span>{topic.title}
                          </span>
                        </label>
                      ))}
                    </div>
                  </section>
                  <div>
                    <Label htmlFor={`attendance-${recoverySession.id}`} className="mb-2 flex items-center gap-2">
                      <Users className="h-4 w-4" /> Students attended
                    </Label>
                    <Input
                      id={`attendance-${recoverySession.id}`}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder={recoverySession.studentsExpected ? `Expected ${recoverySession.studentsExpected}` : "Enter total"}
                      value={attendanceBySession[recoverySession.id] ?? ""}
                      onChange={(event) => setAttendanceBySession((current) => ({ ...current, [recoverySession.id]: event.target.value }))}
                      className="h-12 text-lg"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`remarks-${recoverySession.id}`}>
                      Remarks
                      {selected.size < recoverySession.topics.length && (
                        <span className="ml-1 font-normal text-slate-400">
                          (required — explain what wasn't covered)
                        </span>
                      )}
                    </Label>
                    <Textarea
                      id={`remarks-${recoverySession.id}`}
                      placeholder="How did the session go?"
                      value={remarksBySession[recoverySession.id] ?? ""}
                      onChange={(event) =>
                        setRemarksBySession((current) => ({
                          ...current,
                          [recoverySession.id]: event.target.value,
                        }))
                      }
                      className="min-h-20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`qa-link-${recoverySession.id}`}>
                      QA report link{" "}
                      <span className="font-normal text-slate-400">(optional)</span>
                    </Label>
                    <Textarea
                      id={`qa-link-${recoverySession.id}`}
                      placeholder="Paste the QA report link — one per line if there's more than one"
                      value={qaLinksBySession[recoverySession.id] ?? ""}
                      onChange={(event) =>
                        setQaLinksBySession((current) => ({
                          ...current,
                          [recoverySession.id]: event.target.value,
                        }))
                      }
                      className="min-h-16"
                    />
                  </div>
                  <Button
                    className="h-12 w-full text-base"
                    disabled={submitting === recoverySession.id}
                    onClick={() => void submit(recoverySession)}
                  >
                    {submitting === recoverySession.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Submit report
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!loading && curriculum.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Your subject curriculum</CardTitle>
            <p className="text-sm text-slate-500">
              Lecture topics for your assigned campuses and subjects.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <Accordion type="single" collapsible>
              {curriculum.map((group) => (
                <AccordionItem key={`${group.campus}-${group.subject}`} value={`${group.campus}-${group.subject}`}>
                  <AccordionTrigger>
                    <span>
                      <span className="block font-semibold text-slate-900">{group.subject}</span>
                      <span className="block text-xs font-normal text-slate-500">
                        {group.campus} · {group.topics.length} topics
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ol className="space-y-2">
                      {group.topics.map((topic) => (
                        <li key={topic.id} className="flex gap-3 rounded-md bg-slate-50 px-3 py-2 text-slate-700">
                          <span className="w-7 shrink-0 text-right text-xs font-semibold text-slate-400">
                            {topic.sequenceNo}
                          </span>
                          <span className="text-sm">
                            {topic.title}
                            {topic.weekNo != null && (
                              <span className="ml-2 text-xs text-slate-400">Week {topic.weekNo}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}
    </div>
  );
}