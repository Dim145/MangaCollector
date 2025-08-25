// App.jsx
import { Routes, Route, useLocation } from "react-router-dom";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import ProtectedRoute from "./components/ProtectedRoute";
import Header from "./components/Header";
import About from "./components/About";
import ProfilePage from "./components/ProfilePage";
import MangaPage from "./components/MangaPage";
import Wishlist from "./components/Wishlist";

export default function App() {
  const location = useLocation();
  const manga = location.state;

  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<About />} />
        <Route path="/log-in" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/wishlist"
          element={
            <ProtectedRoute>
              <Wishlist />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mangapage"
          element={
            <ProtectedRoute>
              <MangaPage manga={manga} />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  );
}
