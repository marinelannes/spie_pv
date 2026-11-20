import { zodResolver } from "@hookform/resolvers/zod";
import { loginRequestSchema, type LoginRequest } from "@spie/shared";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router";
import { LogoSpie } from "../components/LogoSpie";
import { Alert, Button, Field, Input } from "../components/ui";
import { errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema) });

  if (state.status === "authenticated") return <Navigate to={from ?? "/"} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const user = await login(values);
      if (user.mustChangePassword) navigate("/mot-de-passe", { replace: true });
      else
        navigate(
          from ?? (user.role === "admin" ? "/admin/affaires" : user.role === "preparateur" ? "/preparation" : "/"),
          { replace: true },
        );
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <main className="flex min-h-dvh items-center justify-center bg-brand-700 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6">
          <LogoSpie className="h-14" />
          <h1 className="mt-5 text-2xl font-semibold">Procès-verbaux</h1>
          <p className="text-slate-600">Saisie des PV sur tablette</p>
        </div>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {error && <Alert kind="error">{error}</Alert>}
          <Field label="Adresse e-mail" error={errors.email?.message}>
            {(p) => (
              <Input {...p} {...register("email")} type="email" autoComplete="username" inputMode="email" autoFocus />
            )}
          </Field>
          <Field label="Mot de passe" error={errors.password?.message}>
            {(p) => <Input {...p} {...register("password")} type="password" autoComplete="current-password" />}
          </Field>
          <Button type="submit" className="w-full" busy={isSubmitting}>
            Se connecter
          </Button>
        </form>
        <p className="mt-6 text-sm text-slate-600">
          Mot de passe oublié ou compte verrouillé : contactez l'administrateur de l'outil.
        </p>
      </div>
    </main>
  );
}
