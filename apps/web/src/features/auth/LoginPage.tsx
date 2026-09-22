import type React from "react";
import { useState } from "react";
import { Icon } from "../../components/Icon.js";
import { useAuth } from "./AuthProvider.js";

export function LoginPage(): React.JSX.Element {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await login({ email, password });
    } catch {
      setError("Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <div className="login-brand-icon" aria-hidden="true">
            <Icon name="sparkles" size={18} />
          </div>
          <p className="eyebrow">Shilabs</p>
        </div>
        <h1 id="login-title">AI Sales Engine</h1>
        <p className="login-subtitle">Sign in to access your sales workspace</p>
        <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="login-field">
            <label htmlFor="login-email">Email</label>
            <input
              autoComplete="email"
              id="login-email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
              type="email"
              value={email}
            />
          </div>
          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <div className="password-field">
              <input
                autoComplete="current-password"
                id="login-password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? "Hide secret" : "Show secret"}
                className="password-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                type="button"
              >
                <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
              </button>
            </div>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <button disabled={submitting} type="submit">
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
