// Deterministic color picker based on name hash
const AVATAR_COLORS = [
  { bg: "#245c4f", fg: "#fff" }, // brand green
  { bg: "#2f617f", fg: "#fff" }, // blue
  { bg: "#a76112", fg: "#fff" }, // amber
  { bg: "#7c3aed", fg: "#fff" }, // purple
  { bg: "#db2777", fg: "#fff" }, // pink
  { bg: "#0891b2", fg: "#fff" }, // cyan
  { bg: "#c2410c", fg: "#fff" }, // orange
  { bg: "#4d7c0f", fg: "#fff" }, // lime
  { bg: "#b45309", fg: "#fff" }, // brown
  { bg: "#4338ca", fg: "#fff" }  // indigo
];

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

const SIZES = {
  sm: { width: 28, height: 28, fontSize: 11 },
  md: { width: 36, height: 36, fontSize: 13 },
  lg: { width: 44, height: 44, fontSize: 15 }
};

export function Avatar({
  name,
  size = "sm",
  title
}: {
  name: string;
  size?: keyof typeof SIZES;
  title?: string;
}) {
  const initials = getInitials(name);
  const color = getColor(name);
  const dims = SIZES[size];

  return (
    <span
      className="avatar"
      title={title ?? name}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: dims.width,
        height: dims.height,
        borderRadius: "50%",
        background: color.bg,
        color: color.fg,
        fontSize: dims.fontSize,
        fontWeight: 700,
        flexShrink: 0,
        letterSpacing: "0.02em",
        lineHeight: 1
      }}
    >
      {initials}
    </span>
  );
}
