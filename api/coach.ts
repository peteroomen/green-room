import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handle } from "../server/handlers.ts";
export default function handler(req: VercelRequest, res: VercelResponse) {
  return handle("coach", req, res);
}
