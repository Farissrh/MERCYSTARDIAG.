import type { PropsWithChildren, ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useECUConnection } from "../context/ECUContext";

export function ProtectedRoute({
  children
}: PropsWithChildren): ReactElement | null {
  const { ecuConnected } = useECUConnection();

  if (!ecuConnected) {
    return <Navigate to="/connect" replace />;
  }

  return children as ReactElement;
}
