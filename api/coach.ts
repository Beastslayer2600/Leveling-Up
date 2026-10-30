import { coachRoute } from "../server/app.js";
import { route } from "../server/deps.js";

const handle = route(coachRoute);
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
