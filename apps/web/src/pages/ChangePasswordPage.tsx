import { zodResolver } from "@hookform/resolvers/zod";
import { PASSWORD_MIN_LENGTH, passwordSchema, type AuthUser } from "@spie/shared";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";
import { Alert, Button, Card, Field, Input, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useAuth, useUser } from "../lib/auth";
import { applyApiErrors } from "../lib/forms";

const formSchema = z
  .object({
    currentPassword: z.string().min(1, "Mot de passe actuel requis."),
    newPassword: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { message: "Les deux saisies sont différentes.", path: ["confirm"] })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "Le nouveau mot de passe doit être différent de l'actuel.",
    path: ["newPassword"],
  });
type FormValues = z.infer<typeof formSchema>;

export function ChangePasswordPage() {
  const user = useUser();
  const { updateUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setError(null);
    try {
      const updated = await api<AuthUser>("/api/auth/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      updateUser(updated);
      navigate(updated.role === "admin" ? "/admin/affaires" : "/", { replace: true });
    } catch (err) {
      setError(applyApiErrors(err, setFieldError, ["currentPassword", "newPassword"]));
    }
  });

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Changer le mot de passe" />
      {user.mustChangePassword && (
        <div className="mb-5">
          <Alert kind="info">Votre mot de passe est provisoire : choisissez-en un nouveau pour continuer.</Alert>
        </div>
      )}
      <Card>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {error && <Alert kind="error">{error}</Alert>}
          <Field label="Mot de passe actuel" error={errors.currentPassword?.message}>
            {(p) => <Input {...p} {...register("currentPassword")} type="password" autoComplete="current-password" />}
          </Field>
          <Field
            label="Nouveau mot de passe"
            error={errors.newPassword?.message}
            hint={`${PASSWORD_MIN_LENGTH} caractères minimum. Une phrase de plusieurs mots est plus facile à retenir.`}
          >
            {(p) => <Input {...p} {...register("newPassword")} type="password" autoComplete="new-password" />}
          </Field>
          <Field label="Confirmer le nouveau mot de passe" error={errors.confirm?.message}>
            {(p) => <Input {...p} {...register("confirm")} type="password" autoComplete="new-password" />}
          </Field>
          <Button type="submit" busy={isSubmitting}>
            Enregistrer
          </Button>
        </form>
      </Card>
    </div>
  );
}
