"use client";

import { useState } from "react";
import { isBugOn } from "@/lib/bugs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [welcome, setWelcome] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    // BUG signup-email-validation: only checks that the field is not empty,
    // so "not-an-email" is accepted.
    const emailOk = isBugOn("signup-email-validation") ? email.trim().length > 0 : EMAIL_RE.test(email.trim());
    if (!emailOk) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setWelcome(`Welcome, ${email.trim()}! Your account was created.`);
  }

  if (welcome) {
    return (
      <>
        <h1>Sign up</h1>
        <p className="success">{welcome}</p>
      </>
    );
  }

  return (
    <>
      <h1>Sign up</h1>
      {/* type="text" on purpose: validation is done in JS so the bug is reachable. */}
      <form onSubmit={onSubmit} noValidate>
        <label>
          Email
          <br />
          <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <br />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Create account</button>
      </form>
    </>
  );
}
