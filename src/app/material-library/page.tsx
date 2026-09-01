import { AppShell } from "@/components/app-shell";
import { MaterialLibraryManager } from "@/components/material-library-manager";

export default async function MaterialLibraryPage() {
  return (
    <AppShell>
      <div className="hero">
        <div>
          <p className="eyebrow">Admin / Data Management</p>
          <h1>Material Library</h1>
          <p>Reusable material definitions with supplier info and standard costs</p>
        </div>
      </div>
      <MaterialLibraryManager />
    </AppShell>
  );
}
