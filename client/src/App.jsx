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
import { useState } from "react";

export default function App() {
  const location = useLocation();
  const manga = location.state;
  const [googleUser, setGoogleUser] = useState(null)

  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<About />} />
        <Route path="/log-in" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute setGoogleUser={setGoogleUser}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/wishlist"
          element={
            <ProtectedRoute setGoogleUser={setGoogleUser}>
              <Wishlist />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute setGoogleUser={setGoogleUser}>
              <ProfilePage googleUser={googleUser} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mangapage"
          element={
            <ProtectedRoute setGoogleUser={setGoogleUser}>
              <MangaPage manga={manga} />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  );
}
