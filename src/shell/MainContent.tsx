import type { ReactNode } from "react";
import "./MainContent.css";

export function MainContent({ children }: { children: ReactNode }) {
  return <main className="main-content halo-main-content">{children}</main>;
}
