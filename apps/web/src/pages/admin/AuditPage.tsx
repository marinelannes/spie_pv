import { AUDIT_ACTIONS, type AuditEntryDto } from "@spie/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Alert, Button, Loading, PageHeader, Table, Td } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";

const PAGE = 50;

function Details({ details }: { details: Record<string, unknown> | null }) {
  if (!details) return null;
  return (
    <dl className="text-sm text-slate-700">
      {Object.entries(details).map(([k, v]) => (
        <div key={k} className="flex gap-1">
          <dt className="font-medium">{k} :</dt>
          <dd className="break-all">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditPage() {
  const journal = useInfiniteQuery({
    queryKey: ["admin", "audit"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<AuditEntryDto[]>(`/api/admin/audit?limit=${PAGE}${pageParam ? `&before=${pageParam}` : ""}`),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.id : null),
  });

  return (
    <>
      <PageHeader
        title="Journal d'audit"
        subtitle="Connexions et actions d'administration, du plus récent au plus ancien."
      />
      {journal.isPending ? (
        <Loading />
      ) : journal.isError ? (
        <Alert kind="error">{errorMessage(journal.error)}</Alert>
      ) : (
        <div className="space-y-4">
          <Table head={["Date", "Action", "Par", "Détails", "IP"]}>
            {journal.data.pages.flat().map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-sm">{formatDateTime(e.at)}</Td>
                <Td className="font-medium">{AUDIT_ACTIONS[e.action] ?? e.action}</Td>
                <Td className="text-sm">{e.actor ? e.actor.nom : "—"}</Td>
                <Td>
                  <Details details={e.details} />
                </Td>
                <Td className="text-sm text-slate-600">{e.ip ?? "—"}</Td>
              </tr>
            ))}
          </Table>
          {journal.hasNextPage && (
            <Button variant="secondary" busy={journal.isFetchingNextPage} onClick={() => void journal.fetchNextPage()}>
              Afficher les entrées plus anciennes
            </Button>
          )}
        </div>
      )}
    </>
  );
}
