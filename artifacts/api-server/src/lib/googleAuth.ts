/** Verify a Google OAuth ID token via Google's tokeninfo endpoint. */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
): Promise<{ email: string; name: string; emailVerified: boolean } | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      aud?: string;
      email?: string;
      name?: string;
      email_verified?: string | boolean;
      iss?: string;
    };
    if (data.aud !== clientId) return null;
    if (
      data.iss !== "accounts.google.com" &&
      data.iss !== "https://accounts.google.com"
    ) {
      return null;
    }
    if (!data.email) return null;
    const emailVerified =
      data.email_verified === true || data.email_verified === "true";
    if (!emailVerified) return null;
    return {
      email: data.email,
      name: data.name ?? data.email.split("@")[0] ?? "User",
      emailVerified: true,
    };
  } catch {
    return null;
  }
}
