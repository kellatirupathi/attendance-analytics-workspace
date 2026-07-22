import { Link } from "wouter";
import { Logo } from "@/components/LogoMark";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  BookOpen,
  GraduationCap,
  Activity,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

const RING = 2 * Math.PI * 52;

function Gauge({
  value,
  size = 132,
  label,
  sub,
}: {
  value: number;
  size?: number;
  label: string;
  sub: string;
}) {
  const offset = RING * (1 - value / 100);
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <defs>
            <linearGradient id="gaugeGrad" x1="0" y1="0" x2="120" y2="120">
              <stop stopColor="#FF8A1E" />
              <stop offset="1" stopColor="#F25C05" />
            </linearGradient>
          </defs>
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke="#f1f2f6"
            strokeWidth="11"
          />
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke="url(#gaugeGrad)"
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={RING}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-gray-900">{value}</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            SPI
          </span>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold text-gray-900">{label}</p>
      <p className="text-xs text-gray-500">{sub}</p>
    </div>
  );
}

function MiniBar({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-500">{label}</span>
        <span className="font-semibold text-gray-800">{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#f5f6fa] flex flex-col">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Logo />
          <Link href="/staff-login" className="cursor-pointer">
            <Button variant="outline" className="border-gray-200">
              Staff sign in
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-[520px] h-[520px] bg-brand-500/20 rounded-full blur-3xl -z-10 pointer-events-none" />
          <div
            className="absolute inset-0 -z-10 opacity-[0.4] pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(#d7dbe4 1px, transparent 1px)",
              backgroundSize: "26px 26px",
              maskImage: "linear-gradient(to bottom, black, transparent 70%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, black, transparent 70%)",
            }}
          />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 grid lg:grid-cols-2 gap-14 items-center">
            <div>
              <Badge
                variant="outline"
                className="bg-brand-50 text-brand-700 border-brand-200 px-4 py-1.5 rounded-full mb-6 inline-flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
                NIAT · Skill Performance Index
              </Badge>
              <h1 className="font-serif text-4xl sm:text-5xl lg:text-[3.4rem] font-semibold tracking-tight text-gray-900 leading-[1.08] mb-6">
                One score that shows how{" "}
                <span className="text-brand-600">skill-ready</span> you really
                are.
              </h1>
              <p className="text-lg text-gray-600 max-w-xl mb-8">
                The SPI turns your attendance, quizzes, and practical
                assessments into a single, live signal of academic standing —
                updated in real time from your learning activity.
              </p>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <Link href="/spi/demo">
                  <Button
                    size="lg"
                    className="bg-brand-600 hover:bg-brand-700 text-white rounded-full px-8 h-12 text-base w-full sm:w-auto group"
                  >
                    View a sample report
                    <ArrowRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
                  </Button>
                </Link>
                <Link href="/staff-login">
                  <Button
                    variant="outline"
                    size="lg"
                    className="rounded-full px-8 h-12 text-base w-full sm:w-auto"
                  >
                    Staff sign in
                  </Button>
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-brand-500" /> Real-time data
                </span>
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-green-500" /> Private,
                  shareable links
                </span>
                <span className="flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-brand-500" /> 4 signals
                  combined
                </span>
              </div>
            </div>

            {/* Live report-card visual */}
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-tr from-brand-500/10 to-transparent rounded-[2rem] -z-10" />
              <Card className="border-gray-200 shadow-xl rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white">
                  <div>
                    <p className="text-sm font-bold text-gray-900">
                      Sample SPI Report
                    </p>
                    <p className="text-xs text-gray-400">Live preview</p>
                  </div>
                  <Badge
                    variant="outline"
                    className="bg-green-50 text-green-700 border-green-200 flex items-center gap-1.5"
                  >
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    Healthy
                  </Badge>
                </div>
                <CardContent className="p-6 grid grid-cols-1 gap-6 sm:grid-cols-2 items-center">
                  <Gauge
                    value={82}
                    label="Skill-ready"
                    sub="Semester standing"
                  />
                  <div className="space-y-3">
                    <MiniBar
                      label="Attendance"
                      value={88}
                      tone="bg-green-500"
                    />
                    <MiniBar
                      label="Classroom quizzes"
                      value={74}
                      tone="bg-brand-500"
                    />
                    <MiniBar
                      label="Module quizzes"
                      value={69}
                      tone="bg-brand-400"
                    />
                    <MiniBar
                      label="Assessments"
                      value={80}
                      tone="bg-blue-500"
                    />
                  </div>
                </CardContent>
                <div className="grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100 text-center">
                  {[
                    { k: "Sessions", v: "312" },
                    { k: "Quizzes", v: "48" },
                    { k: "Subjects", v: "6" },
                  ].map((s) => (
                    <div key={s.k} className="py-3">
                      <p className="text-lg font-bold text-gray-900">{s.v}</p>
                      <p className="text-[11px] uppercase tracking-wider text-gray-400">
                        {s.k}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-16 bg-white border-y border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  icon: CheckCircle2,
                  tone: "bg-green-50 text-green-600",
                  title: "Attendance & eligibility",
                  body: "Maintain at least 80% attendance in every subject to stay eligible for assessments and keep your standing healthy.",
                },
                {
                  icon: AlertTriangle,
                  tone: "bg-orange-50 text-orange-600",
                  title: "Recovery mode",
                  body: "Drop below 80% and you enter Recovery Mode. Below 65% and you risk severe academic penalties on your record.",
                },
                {
                  icon: TrendingUp,
                  tone: "bg-brand-50 text-brand-600",
                  title: "Skill Performance Index",
                  body: "Your SPI is a weighted blend of practical skills, quizzes, and assessments — the definitive read on progress.",
                },
              ].map((f) => (
                <Card
                  key={f.title}
                  className="border-gray-100 shadow-sm hover:shadow-md transition-shadow"
                >
                  <CardContent className="pt-6">
                    <div
                      className={`w-12 h-12 ${f.tone} rounded-xl flex items-center justify-center mb-4`}
                    >
                      <f.icon className="w-6 h-6" />
                    </div>
                    <h3 className="text-lg font-bold mb-2">{f.title}</h3>
                    <p className="text-gray-600 text-sm">{f.body}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* How you're assessed */}
        <section className="py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-12 items-start">
              <div>
                <h2 className="font-serif text-3xl font-semibold mb-3">
                  How you're assessed
                </h2>
                <p className="text-gray-600 mb-8 max-w-md">
                  Four weighted signals combine into your SPI. Practical skill
                  work carries the most weight.
                </p>
                <div className="space-y-4">
                  {[
                    { label: "Classroom Quizzes", weight: 10, icon: BookOpen },
                    { label: "Module Quizzes", weight: 15, icon: BookOpen },
                    {
                      label: "Skill Assessments",
                      weight: 25,
                      icon: GraduationCap,
                    },
                    {
                      label: "Final Skill Assessment",
                      weight: 50,
                      icon: GraduationCap,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="p-4 bg-white rounded-xl border border-gray-200 shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-gray-50 rounded-lg text-gray-500">
                            <item.icon className="w-5 h-5" />
                          </div>
                          <span className="font-medium">{item.label}</span>
                        </div>
                        <Badge
                          variant="secondary"
                          className="bg-gray-100 text-gray-700 font-bold"
                        >
                          {item.weight}%
                        </Badge>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
                          style={{ width: `${item.weight}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-6 text-sm text-gray-500 italic">
                  The SPI formula combines these weights with your attendance
                  multiplier.
                </p>
              </div>

              <div className="space-y-8">
                {/* Standing bands */}
                <Card className="border-gray-200 shadow-sm">
                  <div className="p-6 border-b border-gray-100">
                    <h3 className="font-serif text-xl font-semibold">
                      Your standing
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Where your attendance places you.
                    </p>
                  </div>
                  <CardContent className="pt-6 space-y-3">
                    {[
                      {
                        band: "Healthy",
                        range: "80% and above",
                        tone: "bg-green-50 border-green-200 text-green-800",
                        dot: "bg-green-500",
                      },
                      {
                        band: "Recovery",
                        range: "65% – 79%",
                        tone: "bg-orange-50 border-orange-200 text-orange-800",
                        dot: "bg-orange-500",
                      },
                      {
                        band: "Critical",
                        range: "Below 65%",
                        tone: "bg-red-50 border-red-200 text-red-800",
                        dot: "bg-red-500",
                      },
                    ].map((b) => (
                      <div
                        key={b.band}
                        className={`flex items-center justify-between px-4 py-3 rounded-xl border ${b.tone}`}
                      >
                        <span className="flex items-center gap-2 font-semibold">
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${b.dot}`}
                          />
                          {b.band}
                        </span>
                        <span className="text-sm font-medium">{b.range}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-gray-200 shadow-sm">
                  <div className="p-6 border-b border-gray-100">
                    <h3 className="font-serif text-xl font-semibold">
                      Eligibility checklist
                    </h3>
                  </div>
                  <CardContent className="pt-6">
                    <ul className="space-y-3">
                      {[
                        "≥80% attendance required in all subjects",
                        "No subjects currently in Recovery Mode",
                        "Completed all prerequisites and assessments",
                      ].map((t) => (
                        <li key={t} className="flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                          <span className="text-gray-700">{t}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card className="bg-brand-50 border-brand-200 shadow-sm">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3 mb-2">
                      <AlertTriangle className="w-5 h-5 text-brand-600" />
                      <h3 className="font-bold text-brand-900">Skill Debt</h3>
                    </div>
                    <p className="text-brand-800 text-sm">
                      Falling behind on assessments or attendance accumulates
                      "Skill Debt", which blocks the Final Assessment until it's
                      resolved.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="pb-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-3xl bg-gray-900 px-8 py-14 text-center">
              <div className="absolute -top-16 -right-10 w-72 h-72 bg-brand-500/30 rounded-full blur-3xl" />
              <div className="absolute -bottom-16 -left-10 w-72 h-72 bg-brand-600/20 rounded-full blur-3xl" />
              <h2 className="relative font-serif text-3xl font-semibold text-white mb-3">
                Know exactly where you stand.
              </h2>
              <p className="relative text-gray-300 max-w-xl mx-auto mb-8">
                Open your live SPI report to see attendance, quiz performance,
                and eligibility in one place.
              </p>
              <div className="relative flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/spi/demo">
                  <Button
                    size="lg"
                    className="bg-brand-600 hover:bg-brand-700 text-white rounded-full px-8 h-12 text-base w-full sm:w-auto"
                  >
                    View a sample report
                  </Button>
                </Link>
                <Link href="/staff-login">
                  <Button
                    size="lg"
                    variant="outline"
                    className="rounded-full px-8 h-12 text-base w-full sm:w-auto border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                  >
                    Staff sign in
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-gray-200 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <Logo />
          <p className="text-gray-500 text-sm">
            © {new Date().getFullYear()} NIAT. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
