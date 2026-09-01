import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";

import { ProtectedRoute } from "../routes/ProtectedRoute";
import { ConnectionPage } from "./components/ConnectionPage";
import { DashboardPage } from "./components/DashboardPage";
import { LandingPage } from "./components/LandingPage";

export default function App() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/connect" element={<ConnectionPage />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toaster richColors position="top-right" closeButton />
    </div>
  );
}
