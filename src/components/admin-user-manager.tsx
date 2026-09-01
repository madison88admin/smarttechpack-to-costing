"use client";

import { useState, type FormEvent } from "react";
import type { UserProfile } from "@/lib/auth/users";

export function AdminUserManager({ users }: { users: UserProfile[] }) {
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Saving user...");
    const form = new FormData(event.currentTarget);
    const payload = {
      id: form.get("id") ? String(form.get("id")) : undefined,
      displayName: String(form.get("displayName") ?? ""),
      email: String(form.get("email") ?? ""),
      role: String(form.get("role") ?? "viewer"),
      password: String(form.get("password") ?? ""),
      isActive: form.get("isActive") !== "false"
    };
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    setMessage(response.ok && result.ok ? "User saved. Refreshing..." : result.error ?? "Unable to save user");
    if (response.ok && result.ok) window.location.reload();
  }

  async function toggle(user: UserProfile) {
    setMessage("Updating user...");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_active", id: user.id, isActive: !user.is_active })
    });
    const result = await response.json();
    setMessage(response.ok && result.ok ? "User updated. Refreshing..." : result.error ?? "Unable to update user");
    if (response.ok && result.ok) window.location.reload();
  }

  return (
    <div className="grid">
      <form className="form-grid" onSubmit={save}>
        <div className="field">
          <label htmlFor="displayName">Name</label>
          <input id="displayName" name="displayName" className="input" placeholder="New user name" required />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" className="input" placeholder="user@madison88.com" type="email" required />
        </div>
        <div className="field">
          <label htmlFor="role">Role</label>
          <select id="role" name="role" className="input" defaultValue="viewer">
            <option value="superadmin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="pbd">PBD</option>
            <option value="costing">Costing Team</option>
            <option value="factory">Factory</option>
            <option value="md">MD (Merchandising)</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="password">Temporary Password</label>
          <input id="password" name="password" className="input" type="password" placeholder="Optional for pilot" />
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <button className="button" type="submit">Add User</button>
        </div>
      </form>

      <table className="table compact">
        <thead>
          <tr>
            <th>User</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              {editingId === user.id ? (
                <td colSpan={5}>
                  <form className="form-grid" onSubmit={save}>
                    <input name="id" type="hidden" value={user.id} />
                    <input name="isActive" type="hidden" value={String(user.is_active)} />
                    <div className="field">
                      <label>Name</label>
                      <input name="displayName" className="input" defaultValue={user.display_name} required />
                    </div>
                    <div className="field">
                      <label>Email</label>
                      <input name="email" className="input" defaultValue={user.email ?? ""} type="email" required />
                    </div>
                    <div className="field">
                      <label>Role</label>
                      <select name="role" className="input" defaultValue={user.role}>
                        <option value="superadmin">Super Admin</option>
                        <option value="admin">Admin</option>
                        <option value="manager">Manager</option>
                        <option value="pbd">PBD</option>
                        <option value="costing">Costing Team</option>
                        <option value="factory">Factory</option>
                        <option value="md">MD (Merchandising)</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>New Password</label>
                      <input name="password" className="input" type="password" placeholder="Leave blank to keep current" />
                    </div>
                    <div className="form-actions">
                      <button className="button" type="submit">Save</button>
                      <button className="button secondary" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </form>
                </td>
              ) : (
                <>
                  <td><strong>{user.display_name}</strong></td>
                  <td>{user.email ?? "No email"}</td>
                  <td><span className="activity-role">{user.role.toUpperCase()}</span></td>
                  <td>{user.is_active ? "Active" : "Inactive"}</td>
                  <td>
                    <div className="input-row">
                      <button className="button secondary" type="button" onClick={() => setEditingId(user.id)}>
                        Edit
                      </button>
                      <button className="button secondary" type="button" onClick={() => toggle(user)}>
                        {user.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {message ? <p className="form-message saved">{message}</p> : null}
    </div>
  );
}
