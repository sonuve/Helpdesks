import { Navigate, Route, Routes } from "react-router-dom";
import { GuestRoute } from "./components/GuestRoute.tsx";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";

function App() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
