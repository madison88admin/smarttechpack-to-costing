import type { CostingNote } from "@/lib/costing/history";

export function CostingNotesPanel({ notes, error }: { notes?: CostingNote[] | null; error?: string | null }) {
  if (error) {
    return (
      <section className="panel">
        <h2>Lessons Learned</h2>
        <p className="notice">Unable to load costing notes: {error}</p>
      </section>
    );
  }

  if (!notes || notes.length === 0) {
    return (
      <section className="panel">
        <h2>Lessons Learned</h2>
        <p className="eyebrow">No historical costing notes for this attribute combination yet.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Lessons Learned</h2>
      <p className="eyebrow">Historical costing notes from similar styles (yarn / knit / machine)</p>
      <ul className="list compact-list">
        {notes.map((note) => (
          <li key={note.id}>
            <strong>{note.note_type === "learning" ? "Learning" : note.note_type}</strong>
            {note.created_by_role ? <span className="activity-role">{note.created_by_role.toUpperCase()}</span> : null}
            <br />
            {note.note}
            {note.tags?.length ? (
              <>
                <br />
                <span className="eyebrow">Tags: {note.tags.join(", ")}</span>
              </>
            ) : null}
            {note.historical_costings?.style_number ? (
              <>
                <br />
                <span className="eyebrow">From: {note.historical_costings.style_number}</span>
              </>
            ) : null}
            <br />
            <span className="eyebrow">{formatDate(note.created_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
