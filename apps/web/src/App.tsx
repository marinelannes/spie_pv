import { Navigate, Route, Routes } from "react-router";
import { Layout, RequireAuth } from "./components/Layout";
import { AffaireFormPage } from "./pages/admin/AffaireFormPage";
import { AffairesPage } from "./pages/admin/AffairesPage";
import { AuditPage } from "./pages/admin/AuditPage";
import { SharePointPage } from "./pages/admin/SharePointPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";

export function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/mot-de-passe" element={<ChangePasswordPage />} />
          <Route index element={<HomePage />} />
          <Route path="admin" element={<RequireAuth roles={["admin"]} />}>
            <Route index element={<Navigate to="affaires" replace />} />
            <Route path="affaires" element={<AffairesPage />} />
            <Route path="affaires/nouvelle" element={<AffaireFormPage />} />
            <Route path="affaires/:id" element={<AffaireFormPage />} />
            <Route path="utilisateurs" element={<UsersPage />} />
            <Route path="sharepoint" element={<SharePointPage />} />
            <Route path="journal" element={<AuditPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
