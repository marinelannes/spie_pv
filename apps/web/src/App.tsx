import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Layout, RequireAuth } from "./components/Layout";
import { Loading } from "./components/ui";
import { AffaireFormPage } from "./pages/admin/AffaireFormPage";
import { AffairesPage } from "./pages/admin/AffairesPage";
import { AuditPage } from "./pages/admin/AuditPage";
import { DepotsPage } from "./pages/admin/DepotsPage";
import { SharePointPage } from "./pages/admin/SharePointPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { IoImportPage } from "./pages/prep/IoImportPage";
import { IoListePage } from "./pages/prep/IoListePage";
import { PrepAffairePage } from "./pages/prep/PrepAffairePage";
import { PrepAffairesPage } from "./pages/prep/PrepAffairesPage";
import { PvPrepPage } from "./pages/prep/PvPrepPage";
import { ReservesPage } from "./pages/prep/ReservesPage";
import { SuiviPage } from "./pages/prep/SuiviPage";
import { AffairePage } from "./pages/tech/AffairePage";
import { PvPage } from "./pages/tech/PvPage";
import { SignaturePage } from "./pages/tech/SignaturePage";

// Le rendu des modèles (React côté « serveur », Paged.js) n'est chargé qu'à l'aperçu ; le morceau est précaché.
const ApercuPage = lazy(() => import("./pages/tech/ApercuPage").then((m) => ({ default: m.ApercuPage })));

export function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/mot-de-passe" element={<ChangePasswordPage />} />
          {/* Tablette : utilisable hors ligne (spec §6.1). */}
          <Route index element={<HomePage />} />
          <Route path="affaires/:affaireId" element={<AffairePage />} />
          <Route path="pv/:versionId" element={<PvPage />} />
          <Route
            path="pv/:versionId/apercu"
            element={
              <Suspense fallback={<Loading label="Préparation de l'aperçu…" />}>
                <ApercuPage />
              </Suspense>
            }
          />
          <Route path="pv/:versionId/signature" element={<SignaturePage />} />
          {/* Back-office de préparation et de suivi : préparateurs et administrateurs (spec §2, §4.6). */}
          <Route element={<RequireAuth roles={["preparateur", "admin"]} />}>
            <Route path="preparation" element={<PrepAffairesPage />} />
            <Route path="preparation/affaires/:id" element={<PrepAffairePage />} />
            <Route path="preparation/affaires/:id/import" element={<IoImportPage />} />
            <Route path="preparation/io-lists/:listeId" element={<IoListePage />} />
            <Route path="preparation/pv/:pvId" element={<PvPrepPage />} />
            <Route path="suivi" element={<SuiviPage />} />
            <Route path="reserves" element={<ReservesPage />} />
          </Route>
          <Route path="admin" element={<RequireAuth roles={["admin"]} />}>
            <Route index element={<Navigate to="affaires" replace />} />
            <Route path="affaires" element={<AffairesPage />} />
            <Route path="affaires/nouvelle" element={<AffaireFormPage />} />
            <Route path="affaires/:id" element={<AffaireFormPage />} />
            <Route path="utilisateurs" element={<UsersPage />} />
            <Route path="sharepoint" element={<SharePointPage />} />
            <Route path="depots" element={<DepotsPage />} />
            <Route path="journal" element={<AuditPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
