import { zodResolver } from "@hookform/resolvers/zod";
import {
  ROLE_LABELS,
  createAffaireRequestSchema,
  type AffaireDetailDto,
  type DossierSharePoint,
  type UserDto,
} from "@spie/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import type { z } from "zod";
import { SharePointFolderPicker } from "../../components/SharePointFolderPicker";
import { TestUploadButton } from "../../components/TestUpload";
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { applyApiErrors } from "../../lib/forms";

const formSchema = createAffaireRequestSchema.omit({ dossierSharePoint: true });
type FormValues = z.input<typeof formSchema>;
const FIELDS = ["numero", "client", "projet", "site", "valideParDefaut", "approuveParDefaut"];

const affaireKey = (id: string) => ["admin", "affaire", id];

function AffaireForm({ affaire }: { affaire?: AffaireDetailDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dossier, setDossier] = useState<DossierSharePoint | null>(affaire?.dossierSharePoint ?? null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: affaire
      ? {
          numero: affaire.numero,
          client: affaire.client,
          projet: affaire.projet,
          site: affaire.site,
          valideParDefaut: affaire.valideParDefaut,
          approuveParDefaut: affaire.approuveParDefaut,
        }
      : {},
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setSaved(false);
    try {
      const body = { ...values, dossierSharePoint: dossier };
      const result = affaire
        ? await api<AffaireDetailDto>(`/api/admin/affaires/${affaire.id}`, { method: "PATCH", body })
        : await api<AffaireDetailDto>("/api/admin/affaires", { method: "POST", body });
      queryClient.setQueryData(affaireKey(result.id), result);
      await queryClient.invalidateQueries({ queryKey: ["admin", "affaires"] });
      if (affaire) setSaved(true);
      else navigate(`/admin/affaires/${result.id}`, { replace: true });
    } catch (err) {
      setError(applyApiErrors(err, setFieldError, FIELDS));
    }
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {error && <Alert kind="error">{error}</Alert>}
        {saved && <Alert kind="success">Affaire enregistrée.</Alert>}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="N° d'affaire" error={errors.numero?.message} hint="Ex. A35173. Repris dans le numéro des PV.">
            {(p) => <Input {...p} {...register("numero")} autoComplete="off" className="uppercase" />}
          </Field>
          <Field label="Client" error={errors.client?.message}>
            {(p) => <Input {...p} {...register("client")} />}
          </Field>
          <Field label="Projet" error={errors.projet?.message}>
            {(p) => <Input {...p} {...register("projet")} />}
          </Field>
          <Field label="Site" error={errors.site?.message}>
            {(p) => <Input {...p} {...register("site")} />}
          </Field>
          <Field
            label="« Validé par » par défaut"
            error={errors.valideParDefaut?.message}
            hint="Repris dans le tableau des révisions."
          >
            {(p) => <Input {...p} {...register("valideParDefaut")} />}
          </Field>
          <Field label="« Approuvé par » par défaut" error={errors.approuveParDefaut?.message}>
            {(p) => <Input {...p} {...register("approuveParDefaut")} />}
          </Field>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-slate-800">Dossier SharePoint cible</p>
          {picking ? (
            <SharePointFolderPicker
              initial={dossier}
              onCancel={() => setPicking(false)}
              onSelect={(d) => {
                setDossier(d);
                setPicking(false);
              }}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {dossier ? (
                <span className="font-mono text-sm">{dossier.path}</span>
              ) : (
                <Badge tone="amber">Non défini</Badge>
              )}
              <Button variant="secondary" onClick={() => setPicking(true)}>
                {dossier ? "Changer" : "Choisir le dossier"}
              </Button>
              {dossier && (
                <Button variant="ghost" onClick={() => setDossier(null)}>
                  Retirer
                </Button>
              )}
            </div>
          )}
          <p className="text-sm text-slate-600">Les PV de l'affaire seront déposés sous ce dossier.</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" busy={isSubmitting}>
            {affaire ? "Enregistrer" : "Créer l'affaire"}
          </Button>
          <Link to="/admin/affaires" className="inline-flex min-h-12 items-center px-3 font-semibold text-brand-800">
            Retour à la liste
          </Link>
        </div>
      </form>
    </Card>
  );
}

function Affectations({ affaire }: { affaire: AffaireDetailDto }) {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: () => api<UserDto[]>("/api/admin/users") });
  const [selected, setSelected] = useState<Set<string>>(() => new Set(affaire.affectations.map((a) => a.userId)));
  const save = useMutation({
    mutationFn: () =>
      api<AffaireDetailDto>(`/api/admin/affaires/${affaire.id}/affectations`, {
        method: "PUT",
        body: { userIds: [...selected] },
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(affaireKey(affaire.id), result);
      return queryClient.invalidateQueries({ queryKey: ["admin", "affaires"] });
    },
  });

  // Les administrateurs voient toutes les affaires : on ne propose que techniciens et préparateurs actifs,
  // plus les comptes déjà affectés.
  const candidates = (users.data ?? []).filter((u) => (u.actif && u.role !== "admin") || selected.has(u.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">Techniciens et préparateurs affectés</h2>
      <p className="mb-4 text-slate-600">Ils voient cette affaire et ses PV sur leur tablette.</p>
      {users.isPending ? (
        <Loading />
      ) : users.isError ? (
        <Alert kind="error">{errorMessage(users.error)}</Alert>
      ) : candidates.length === 0 ? (
        <Alert kind="info">Aucun technicien ni préparateur actif. Créez d'abord les comptes.</Alert>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {candidates.map((u) => (
            <li key={u.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 border-slate-200 px-3 has-checked:border-brand-600 has-checked:bg-brand-50">
                <input
                  type="checkbox"
                  className="size-6 accent-brand-700"
                  checked={selected.has(u.id)}
                  onChange={() => toggle(u.id)}
                />
                <span>
                  <span className="font-semibold">{u.nom}</span>
                  <span className="block text-sm text-slate-600">
                    {ROLE_LABELS[u.role]}
                    {!u.actif && " — désactivé"}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button busy={save.isPending} onClick={() => save.mutate()}>
          Enregistrer les affectations
        </Button>
        {save.isSuccess && <span className="font-medium text-green-800">Affectations enregistrées.</span>}
        {save.isError && <span className="font-medium text-red-700">{errorMessage(save.error)}</span>}
      </div>
    </Card>
  );
}

function Archivage({ affaire }: { affaire: AffaireDetailDto }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      api<AffaireDetailDto>(`/api/admin/affaires/${affaire.id}`, {
        method: "PATCH",
        body: { archivee: !affaire.archivee },
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(affaireKey(affaire.id), result);
      return queryClient.invalidateQueries({ queryKey: ["admin", "affaires"] });
    },
  });
  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">Archivage</h2>
      <p className="mb-4 text-slate-600">
        {affaire.archivee
          ? "Cette affaire est archivée : elle n'apparaît plus sur les tablettes."
          : "Une affaire archivée n'apparaît plus sur les tablettes. Ses PV restent dans SharePoint."}
      </p>
      <Button variant="secondary" busy={toggle.isPending} onClick={() => toggle.mutate()}>
        {affaire.archivee ? "Désarchiver" : "Archiver l'affaire"}
      </Button>
      {toggle.isError && <p className="mt-2 text-red-700">{errorMessage(toggle.error)}</p>}
    </Card>
  );
}

export function AffaireFormPage() {
  const { id } = useParams();
  const detail = useQuery({
    queryKey: affaireKey(id ?? "nouvelle"),
    queryFn: () => api<AffaireDetailDto>(`/api/admin/affaires/${id}`),
    enabled: Boolean(id),
  });

  if (!id) {
    return (
      <>
        <PageHeader title="Nouvelle affaire" />
        <AffaireForm />
      </>
    );
  }
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <Alert kind="error">{errorMessage(detail.error)}</Alert>;
  const affaire = detail.data;

  return (
    <>
      <PageHeader
        title={`Affaire ${affaire.numero}`}
        subtitle={affaire.projet}
        actions={affaire.archivee ? <Badge>Archivée</Badge> : undefined}
      />
      <div className="space-y-6">
        <AffaireForm affaire={affaire} />
        <Affectations affaire={affaire} />
        <Card>
          <h2 className="mb-1 text-lg font-bold">Test de dépôt SharePoint</h2>
          <p className="mb-4 text-slate-600">
            Dépose un petit fichier texte dans le dossier de l'affaire pour vérifier les droits d'écriture.
          </p>
          {affaire.dossierSharePoint ? (
            <TestUploadButton target={{ affaireId: affaire.id }} />
          ) : (
            <Alert kind="info">Choisissez d'abord le dossier SharePoint cible de l'affaire.</Alert>
          )}
        </Card>
        <Archivage affaire={affaire} />
      </div>
    </>
  );
}
