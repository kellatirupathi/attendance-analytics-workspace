import { useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { SubNav, reportsNav } from "@/components/SubNav";

type ReportsTab = "spi-record" | "skill-debt" | "insights";

const TAB_COPY: Record<
  ReportsTab,
  { title: string; description: string }
> = {
  "spi-record": {
    title: "SPI Record",
    description: "Campus and section SPI standings will appear here.",
  },
  "skill-debt": {
    title: "Skill Debt",
    description: "Students with active Skill Debt will appear here.",
  },
  insights: {
    title: "Insights",
    description: "Trends and highlights across SPI will appear here.",
  },
};

function tabFromPath(path: string): ReportsTab {
  if (path === "/dashboard/reports/skill-debt") return "skill-debt";
  if (path === "/dashboard/reports/insights") return "insights";
  return "spi-record";
}

export default function Reports() {
  const [location] = useLocation();
  const path = location.split("?")[0] ?? location;
  const tab = tabFromPath(path);
  const copy = TAB_COPY[tab];

  return (
    <div className="space-y-4">
      <PageHeader
        badge="Reports"
        title="Reports"
        subtitle="SPI Record, Skill Debt, and Insights for campuses and sections."
      />
      <SubNav items={reportsNav()} />
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
        <p className="text-lg font-semibold text-slate-900">{copy.title}</p>
        <p className="mt-2 text-sm text-slate-500">Coming soon</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
          {copy.description}
        </p>
      </div>
    </div>
  );
}
