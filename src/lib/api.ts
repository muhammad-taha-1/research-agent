import type { z } from "zod";

// Small helpers so every route handler answers errors the same way: { error, issues? }

export function jsonError(status: number, error: string, issues?: unknown) {
  return Response.json(issues ? { error, issues } : { error }, { status });
}

export const unauthorized = () => jsonError(401, "Unauthorized");
export const notFound = () => jsonError(404, "Not found");

/** Parse a JSON body against a schema; returns the data or a ready-made 400 response. */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { response: jsonError(400, "Body must be valid JSON") };
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      response: jsonError(400, result.error.issues[0]?.message ?? "Invalid input", result.error.issues),
    };
  }
  return { data: result.data };
}
