import { zodResolver } from "@hookform/resolvers/zod";
import {
  ROLES,
  ROLE_LABELS,
  createUserRequestSchema,
  type CreateUserRequest,
  type Role,
  type TemporaryPasswordResponse,
  type UserDto,
} from "@spie/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Table,
  Td,
  TemporaryPassword,
} from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { formatDateTime } from "../../lib/format";
import { applyApiErrors } from "../../lib/forms";

const USERS_KEY = ["admin", "users"];

function StatusBadges({ u }: { u: UserDto }) {
  const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
  return (
    <div className="flex flex-wrap gap-1">
      {u.actif ? <Badge tone="green">Actif</Badge> : <Badge tone="red">Désactivé</Badge>}
      {locked && <Badge tone="amber">Verrouillé</Badge>}
      {u.mustChangePassword && <Badge tone="blue">Mot de passe provisoire</Badge>}
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: (r: TemporaryPasswordResponse) => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserRequest>({
    resolver: zodResolver(createUserRequestSchema),
    defaultValues: { role: "technicien" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<TemporaryPasswordResponse>("/api/admin/users", { method: "POST", body: values });
      reset({ email: "", nom: "", role: values.role });
      await queryClient.invalidateQueries({ queryKey: USERS_KEY });
      onCreated(res);
    } catch (err) {
      setError(applyApiErrors(err, setFieldError, ["email", "nom", "role"]));
    }
  });

  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">Nouveau compte</h2>
      <form
        onSubmit={onSubmit}
        noValidate
        className="grid gap-4 md:grid-cols-[2fr_2fr_minmax(11rem,1fr)_auto] md:items-start"
      >
        <Field label="Adresse e-mail professionnelle" error={errors.email?.message}>
          {(p) => <Input {...p} {...register("email")} type="email" autoComplete="off" />}
        </Field>
        <Field label="Nom" error={errors.nom?.message}>
          {(p) => <Input {...p} {...register("nom")} autoComplete="off" placeholder="Prénom Nom" />}
        </Field>
        <Field label="Rôle" error={errors.role?.message}>
          {(p) => (
            <Select {...p} {...register("role")}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" busy={isSubmitting} className="md:mt-7">
          Créer
        </Button>
        {error && (
          <div className="md:col-span-4">
            <Alert kind="error">{error}</Alert>
          </div>
        )}
      </form>
    </Card>
  );
}

function UserRow({ u, onPassword }: { u: UserDto; onPassword: (r: TemporaryPasswordResponse) => void }) {
  const me = useUser();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [nom, setNom] = useState(u.nom);
  const [role, setRole] = useState<Role>(u.role);
  const isMe = u.id === me.id;

  const update = useMutation({
    mutationFn: (changes: Partial<Pick<UserDto, "nom" | "role" | "actif">>) =>
      api<UserDto>(`/api/admin/users/${u.id}`, { method: "PATCH", body: changes }),
    onSuccess: () => {
      setEditing(false);
      return queryClient.invalidateQueries({ queryKey: USERS_KEY });
    },
  });
  const reset = useMutation({
    mutationFn: () => api<TemporaryPasswordResponse>(`/api/admin/users/${u.id}/reset-password`, { method: "POST" }),
    onSuccess: (r) => {
      onPassword(r);
      return queryClient.invalidateQueries({ queryKey: USERS_KEY });
    },
  });
  const error = update.error ?? reset.error;

  return (
    <tr className={u.actif ? "" : "bg-slate-50 text-slate-500"}>
      <Td>
        {editing ? (
          <Input value={nom} onChange={(e) => setNom(e.target.value)} aria-label="Nom" />
        ) : (
          <>
            <div className="font-semibold">{u.nom}</div>
            <div className="text-sm text-slate-600">{u.email}</div>
          </>
        )}
        {error && <p className="mt-1 text-sm text-red-700">{errorMessage(error)}</p>}
      </Td>
      <Td>
        {editing && !isMe ? (
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Rôle">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        ) : (
          ROLE_LABELS[u.role]
        )}
      </Td>
      <Td>
        <StatusBadges u={u} />
      </Td>
      <Td className="text-sm">{formatDateTime(u.lastLoginAt)}</Td>
      <Td>
        <div className="flex flex-wrap justify-end gap-2">
          {editing ? (
            <>
              <Button busy={update.isPending} onClick={() => update.mutate({ nom, ...(isMe ? {} : { role }) })}>
                Enregistrer
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Annuler
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Modifier
              </Button>
              <Button
                variant="secondary"
                busy={reset.isPending}
                onClick={() => {
                  if (
                    confirm(`Générer un nouveau mot de passe provisoire pour ${u.email} ? Ses sessions seront fermées.`)
                  ) {
                    reset.mutate();
                  }
                }}
              >
                Réinitialiser le mot de passe
              </Button>
              {!isMe && (
                <Button
                  variant={u.actif ? "danger" : "secondary"}
                  busy={update.isPending}
                  onClick={() => {
                    if (!u.actif || confirm(`Désactiver le compte de ${u.nom} ? Ses sessions seront fermées.`)) {
                      update.mutate({ actif: !u.actif });
                    }
                  }}
                >
                  {u.actif ? "Désactiver" : "Réactiver"}
                </Button>
              )}
            </>
          )}
        </div>
      </Td>
    </tr>
  );
}

export function UsersPage() {
  const users = useQuery({ queryKey: USERS_KEY, queryFn: () => api<UserDto[]>("/api/admin/users") });
  const [shown, setShown] = useState<TemporaryPasswordResponse | null>(null);

  return (
    <>
      <PageHeader
        title="Utilisateurs"
        subtitle="Comptes de l'application. Pas d'inscription libre : les comptes sont créés ici."
      />
      <div className="space-y-6">
        <CreateUserForm onCreated={setShown} />
        {shown && (
          <TemporaryPassword
            email={shown.user.email}
            password={shown.temporaryPassword}
            onClose={() => setShown(null)}
          />
        )}
        {users.isPending ? (
          <Loading />
        ) : users.isError ? (
          <Alert kind="error">{errorMessage(users.error)}</Alert>
        ) : (
          <Table head={["Nom", "Rôle", "Statut", "Dernière connexion", ""]}>
            {users.data.map((u) => (
              <UserRow key={u.id} u={u} onPassword={setShown} />
            ))}
          </Table>
        )}
      </div>
    </>
  );
}
