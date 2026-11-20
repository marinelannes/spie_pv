import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { Alert, Loading, PageHeader } from "../../components/ui";
import { construirePvDocument } from "../../offline/pv-local";
import { ApercuPv } from "../../pv/Apercu";
import { usePvLocal } from "./PvPage";

/** Aperçu hors ligne du PV, même rendu que le PDF final (spec §3.2 étape 5, §8.2). */
export function ApercuPage() {
  const { versionId = "" } = useParams();
  const { pv, affaire } = usePvLocal(versionId);
  const doc = useMemo(() => (pv ? construirePvDocument(pv, affaire ?? undefined, new Date()) : null), [pv, affaire]);
  if (pv === undefined || affaire === undefined) return <Loading />;
  if (pv === null || !doc) return <Alert kind="warning">Ce PV n'est pas sur cette tablette.</Alert>;
  return (
    <>
      <PageHeader
        title={`Aperçu du PV ${pv.numero}`}
        subtitle={
          <Link to={`/pv/${pv.versionId}`} className="underline">
            Retour au PV
          </Link>
        }
      />
      <ApercuPv doc={doc} />
    </>
  );
}
