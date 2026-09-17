"use client";

// Pass-through wrapper kept so AppShell keeps a stable tree shape.
// NOTE: this must NOT render another `.content` element (the page already
// provides `section.content`) and must NOT key on the pathname — remounting
// the whole content tree on navigation wipes client state (filters, tabs,
// form input) and replays every entrance animation.
export function PageTransition({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
