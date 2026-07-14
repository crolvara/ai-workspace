import { db } from "@/lib/db";
import { MODELS, PROVIDER_LABELS, type ProviderId } from "@/lib/models";

// Cached for a minute — three DB aggregates per request is otherwise an easy
// load vector for a public page.
export const revalidate = 60;

function modelLabel(key: string): string {
  return MODELS.find((m) => m.key === key)?.label ?? key;
}

function sevenDaysAgo(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

export default async function UsagePage() {
  const since = sevenDaysAgo();

  const [totals, perModel, errors] = await Promise.all([
    db.usageLog.aggregate({
      where: { createdAt: { gte: since }, ok: true },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true },
      _avg: { latencyMs: true },
    }),
    db.usageLog.groupBy({
      by: ["provider", "model"],
      where: { createdAt: { gte: since }, ok: true },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true },
      _avg: { latencyMs: true },
      orderBy: { _count: { model: "desc" } },
    }),
    db.usageLog.count({ where: { createdAt: { gte: since }, ok: false } }),
  ]);

  const stats = [
    { label: "Requests", value: totals._count.toLocaleString("en-US") },
    {
      label: "Input tokens",
      value: (totals._sum.inputTokens ?? 0).toLocaleString("en-US"),
    },
    {
      label: "Output tokens",
      value: (totals._sum.outputTokens ?? 0).toLocaleString("en-US"),
    },
    {
      label: "Avg. latency",
      value: `${((totals._avg.latencyMs ?? 0) / 1000).toFixed(1)} s`,
    },
    { label: "Errors", value: errors.toLocaleString("en-US") },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Usage</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform usage over the last 7 days. All models are free — we track
            tokens and quotas, not money.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border p-4">
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {s.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-4 py-2.5 font-medium">Model</th>
                <th className="px-4 py-2.5 font-medium">Provider</th>
                <th className="px-4 py-2.5 text-right font-medium">Requests</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Tokens (input/output)
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Avg. latency
                </th>
              </tr>
            </thead>
            <tbody>
              {perModel.map((row) => (
                <tr key={row.model} className="border-b last:border-0">
                  <td className="px-4 py-2.5">{modelLabel(row.model)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {PROVIDER_LABELS[row.provider as ProviderId] ?? row.provider}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row._count}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {(row._sum.inputTokens ?? 0).toLocaleString("en-US")} /{" "}
                    {(row._sum.outputTokens ?? 0).toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {((row._avg.latencyMs ?? 0) / 1000).toFixed(1)} s
                  </td>
                </tr>
              ))}
              {perModel.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No data yet — send your first message.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
