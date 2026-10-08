import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router";
import { api } from "./api";
import { Layout } from "./components/Layout";
import { AlertsPage } from "./pages/AlertsPage";
import { LoginPage } from "./pages/LoginPage";
import { SearchEditorPage } from "./pages/SearchEditorPage";
import { SearchesPage } from "./pages/SearchesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TrackingPage } from "./pages/TrackingPage";

export function App() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: Infinity });

  if (me.isPending) return <div className="splash" aria-busy="true" />;
  if (me.isError) return <div className="splash">Serveur injoignable : {me.error.message}</div>;
  if (!me.data) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<SearchesPage />} />
        <Route path="recherches/nouvelle" element={<SearchEditorPage />} />
        <Route path="recherches/:id" element={<SearchEditorPage />} />
        <Route path="alertes" element={<AlertsPage />} />
        <Route path="suivi" element={<TrackingPage />} />
        <Route path="reglages" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
