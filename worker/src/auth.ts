export function authenticate(request: Request, apiKey: string): boolean {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token === apiKey;
}
