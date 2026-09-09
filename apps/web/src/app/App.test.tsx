/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";

describe("web app", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the login page when no user is authenticated", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "AI Sales Engine" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("shows the authenticated app shell after login", async () => {
    vi.spyOn(window, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessToken: "header.payload.signature",
          user: {
            id: "user_1",
            email: "admin@example.local",
            firstName: "Development",
            lastName: "Admin",
            role: "ADMIN",
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    render(<App />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "admin@example.local" }
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "CorrectHorse123!" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByText("Development Admin")).toBeTruthy();
    });
    expect(screen.getByText("Users")).toBeTruthy();
  });

  it("clears authenticated state on logout", async () => {
    window.localStorage.setItem("shilabs.accessToken", "header.payload.signature");
    window.localStorage.setItem(
      "shilabs.user",
      JSON.stringify({
        id: "user_1",
        email: "rep@example.local",
        firstName: "Sales",
        lastName: "Rep",
        role: "SALES_REP",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    );
    vi.spyOn(window, "fetch").mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(<App />);

    expect(screen.getByText("My Workspace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    });
    expect(window.localStorage.getItem("shilabs.accessToken")).toBeNull();
  });
});
