import type { UserProfile } from "@/lib/auth/users";

export function UserTable({ users }: { users: UserProfile[] }) {
  return (
    <table className="table compact">
      <thead>
        <tr>
          <th>User</th>
          <th>Email</th>
          <th>Role</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id}>
            <td>
              <strong>{user.display_name}</strong>
            </td>
            <td>{user.email ?? "No email"}</td>
            <td>
              <span className="activity-role">{user.role.toUpperCase()}</span>
            </td>
            <td>{user.is_active ? "Active" : "Inactive"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
