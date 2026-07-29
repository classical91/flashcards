import React from "react";
import App from "./App";

const AdminApp = React.lazy(() => import("./admin/AdminApp"));

export default function Root() {
  const isAdminRoute =
    window.location.pathname === "/admin" || window.location.pathname === "/admin/";

  if (!isAdminRoute) return <App />;

  return (
    <React.Suspense fallback={null}>
      <AdminApp />
    </React.Suspense>
  );
}
