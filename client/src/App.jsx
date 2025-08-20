import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import Login from "./components/Login";
import Header from "./components/Header";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      <Header />
      <Routes>
        <Route path="/log-in" element={<Login />} />
      </Routes>
    </>
  );
}
